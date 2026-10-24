import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { trackError } from "../utils/analytics";

type Admin = AdminApiContext;

export type SaleOpResult =
  | { ok: true; variantCount: number }
  | { ok: false; error: string };

// A sale can only be undone shortly after it ended. After that, the merchant
// may have edited prices or started another sale on the same variants.
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

// A sale stuck in "ending" (e.g. the server died mid-operation) can be claimed
// again after this long, so it isn't permanently stuck.
const STALE_ENDING_MS = 5 * 60 * 1000;

// Sales that currently own their variants' prices. A "pending" sale only counts
// while its creation could still be in flight, so a crashed create can't block
// those variants forever.
const PENDING_IN_FLIGHT_MS = 5 * 60 * 1000;
export function inProgressSaleFilter() {
  return {
    OR: [
      { status: { in: ["active", "ending"] } },
      {
        status: "pending",
        createdAt: { gt: new Date(Date.now() - PENDING_IN_FLIGHT_MS) },
      },
    ],
  };
}

const BULK_UPDATE_MUTATION = `#graphql
  mutation UpdateSaleVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors {
        field
        message
      }
    }
  }`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation UpdateProductMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }`;

type SaleVariantRow = {
  variantId: string;
  productId: string;
  originalPrice: string;
  salePrice: string;
};

/**
 * Write prices for every variant, grouped by product. Returns Shopify
 * userErrors messages (safe to show merchants); throws on transport errors.
 */
async function writePrices(
  admin: Admin,
  variants: SaleVariantRow[],
  mode: "restore" | "apply",
): Promise<string[]> {
  const byProduct = new Map<
    string,
    { id: string; price: string; compareAtPrice: string | null }[]
  >();
  for (const v of variants) {
    const list = byProduct.get(v.productId) ?? [];
    list.push(
      mode === "restore"
        ? { id: v.variantId, price: v.originalPrice, compareAtPrice: null }
        : { id: v.variantId, price: v.salePrice, compareAtPrice: v.originalPrice },
    );
    byProduct.set(v.productId, list);
  }

  const errors: string[] = [];
  for (const [productId, list] of byProduct) {
    const response = await admin.graphql(BULK_UPDATE_MUTATION, {
      variables: { productId, variants: list },
    });
    const result = await response.json();
    const userErrors = result.data?.productVariantsBulkUpdate?.userErrors ?? [];
    errors.push(...userErrors.map((e: { message: string }) => e.message));
  }
  return errors;
}

async function setSaleMetafield(
  admin: Admin,
  productIds: string[],
  value: string,
  saleId: string,
) {
  try {
    await admin.graphql(METAFIELDS_SET_MUTATION, {
      variables: {
        metafields: productIds.map((productId) => ({
          ownerId: productId,
          namespace: "set_sales",
          key: "active_sale_id",
          value,
          type: "single_line_text_field",
        })),
      },
    });
  } catch (error) {
    // Metafield is informational only — don't fail the operation
    trackError(error, { operation: "set_sale_metafield", sale_id: saleId });
  }
}

/**
 * End an active sale: restore original prices and clear compare-at prices.
 * Status changes are claimed atomically so concurrent requests can't both run.
 */
export async function endSale(
  admin: Admin,
  shop: string,
  saleId: string,
): Promise<SaleOpResult> {
  const claim = await db.sale.updateMany({
    where: {
      id: saleId,
      shop,
      OR: [
        { status: "active" },
        {
          status: "ending",
          updatedAt: { lt: new Date(Date.now() - STALE_ENDING_MS) },
        },
      ],
    },
    data: { status: "ending" },
  });

  if (claim.count === 0) {
    const existing = await db.sale.findFirst({
      where: { id: saleId, shop },
      select: { status: true },
    });
    if (!existing) return { ok: false, error: "Sale not found" };
    if (existing.status === "ended") {
      return { ok: false, error: "Sale is already ended" };
    }
    return { ok: false, error: "Sale is already being updated. Try again shortly." };
  }

  const sale = await db.sale.findFirstOrThrow({
    where: { id: saleId, shop },
    include: { variants: true },
  });

  const revert = () =>
    db.sale.updateMany({
      where: { id: saleId, shop, status: "ending" },
      data: { status: "active" },
    });

  try {
    const errors = await writePrices(admin, sale.variants, "restore");
    if (errors.length > 0) {
      await revert();
      return { ok: false, error: `Failed to restore prices: ${errors.join(", ")}` };
    }

    const productIds = [...new Set(sale.variants.map((v) => v.productId))];
    await setSaleMetafield(admin, productIds, "", saleId);

    await db.sale.update({ where: { id: saleId }, data: { status: "ended" } });
    return { ok: true, variantCount: sale.variants.length };
  } catch (error) {
    await revert();
    trackError(error, { operation: "end_sale", sale_id: saleId });
    return { ok: false, error: "Failed to end sale. Please try again." };
  }
}

/**
 * Re-apply a recently ended sale. Refuses if the undo window has passed or if
 * any of its variants are now part of another sale.
 */
export async function undoEndSale(
  admin: Admin,
  shop: string,
  saleId: string,
): Promise<SaleOpResult> {
  const sale = await db.sale.findFirst({
    where: { id: saleId, shop },
    include: { variants: true },
  });

  if (!sale) return { ok: false, error: "Sale not found" };
  if (sale.status !== "ended") return { ok: false, error: "Sale is not ended" };
  if (Date.now() - sale.updatedAt.getTime() > UNDO_WINDOW_MS) {
    return { ok: false, error: "This sale ended too long ago to undo" };
  }

  const conflicts = await db.saleVariant.count({
    where: {
      variantId: { in: sale.variants.map((v) => v.variantId) },
      sale: {
        shop,
        id: { not: saleId },
        ...inProgressSaleFilter(),
      },
    },
  });
  if (conflicts > 0) {
    return {
      ok: false,
      error: "Can't undo: some of these products are now in another sale",
    };
  }

  // Claim atomically; updatedAt must still match so a second undo (or any
  // other change since we read the sale) loses the race.
  const claim = await db.sale.updateMany({
    where: { id: saleId, shop, status: "ended", updatedAt: sale.updatedAt },
    data: { status: "active" },
  });
  if (claim.count === 0) {
    return { ok: false, error: "Sale was changed by another request" };
  }

  const revert = () =>
    db.sale.updateMany({
      where: { id: saleId, shop, status: "active" },
      data: { status: "ended" },
    });

  try {
    const errors = await writePrices(admin, sale.variants, "apply");
    if (errors.length > 0) {
      await revert();
      return { ok: false, error: `Failed to reapply sale prices: ${errors.join(", ")}` };
    }

    const productIds = [...new Set(sale.variants.map((v) => v.productId))];
    await setSaleMetafield(admin, productIds, saleId, saleId);

    return { ok: true, variantCount: sale.variants.length };
  } catch (error) {
    await revert();
    trackError(error, { operation: "undo_end_sale", sale_id: saleId });
    return { ok: false, error: "Failed to undo. Please try again." };
  }
}
