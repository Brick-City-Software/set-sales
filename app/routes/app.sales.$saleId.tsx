import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const saleId = params.saleId;

  const sale = await db.sale.findFirst({
    where: { id: saleId, shop: session.shop },
    include: {
      variants: true,
    },
  });

  if (!sale) {
    throw new Response("Sale not found", { status: 404 });
  }

  return { sale };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");
  const saleId = params.saleId;

  if (action === "end") {
    const sale = await db.sale.findFirst({
      where: { id: saleId, shop: session.shop },
      include: { variants: true },
    });

    if (!sale) {
      return { error: "Sale not found" };
    }

    if (sale.status === "ended") {
      return { error: "Sale is already ended" };
    }

    try {
      // Update status to "ending" first to prevent race conditions (Issue #36)
      await db.sale.update({
        where: { id: saleId },
        data: { status: "ending" },
      });

      // Group variants by product ID
      const variantsByProduct = new Map<
        string,
        { id: string; price: string; compareAtPrice: null }[]
      >();

      for (const variant of sale.variants) {
        const existing = variantsByProduct.get(variant.productId) || [];
        existing.push({
          id: variant.variantId,
          price: variant.originalPrice,
          compareAtPrice: null,
        });
        variantsByProduct.set(variant.productId, existing);
      }

      // Restore original prices for each product
      const errors: string[] = [];
      for (const [productId, variants] of variantsByProduct) {
        const response = await admin.graphql(
          `#graphql
          mutation RestoreOriginalPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              productVariants {
                id
                price
                compareAtPrice
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: { productId, variants },
          },
        );

        const result = await response.json();
        const userErrors =
          result.data?.productVariantsBulkUpdate?.userErrors || [];
        if (userErrors.length > 0) {
          errors.push(...userErrors.map((e: { message: string }) => e.message));
        }
      }

      if (errors.length > 0) {
        // Rollback: mark as failed but keep original status
        await db.sale.update({
          where: { id: saleId },
          data: { status: sale.status },
        });
        return { error: `Failed to restore prices: ${errors.join(", ")}` };
      }

      // Finally update status to ended
      await db.sale.update({
        where: { id: saleId },
        data: { status: "ended" },
      });

      return { success: true, message: "Sale ended successfully" };
    } catch (error) {
      // On any error, try to revert status
      await db.sale.update({
        where: { id: saleId },
        data: { status: sale.status },
      });
      return {
        error:
          error instanceof Error ? error.message : "Failed to end sale",
      };
    }
  }

  return { error: "Unknown action" };
};

function formatDiscountType(type: string, value: number): string {
  switch (type) {
    case "percentage":
      return `${value}% off`;
    case "fixed_amount":
      return `$${value.toFixed(2)} off`;
    case "fixed_price":
      return `$${value.toFixed(2)}`;
    default:
      return String(value);
  }
}

export default function SaleDetail() {
  const { sale } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const isEnding = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Sale ended - prices restored");
      navigate("/app/sales");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, navigate]);

  const handleEndSale = () => {
    if (
      confirm(
        "Are you sure you want to end this sale? Original prices will be restored.",
      )
    ) {
      fetcher.submit({ action: "end" }, { method: "POST" });
    }
  };

  // Calculate totals
  const totalOriginal = sale.variants.reduce(
    (sum, v) => sum + parseFloat(v.originalPrice),
    0,
  );
  const totalSale = sale.variants.reduce(
    (sum, v) => sum + parseFloat(v.salePrice),
    0,
  );
  const totalSavings = totalOriginal - totalSale;

  return (
    <s-page heading={sale.name}>
      <Link to="/app/sales" slot="back-action">
        <s-button variant="tertiary">Back to Sales</s-button>
      </Link>

      {sale.status === "active" && (
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={handleEndSale}
          {...(isEnding ? { loading: true } : {})}
        >
          End Sale
        </s-button>
      )}

      <s-section heading="Sale Information">
        <s-stack direction="inline" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <strong>Status</strong>
            <br />
            <s-badge tone={sale.status === "active" ? "success" : undefined}>
              {sale.status === "active" ? "Active" : "Ended"}
            </s-badge>
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <strong>Discount</strong>
            <br />
            {formatDiscountType(sale.discountType, sale.discountValue)}
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <strong>Variants</strong>
            <br />
            {sale.variants.length}
          </s-box>

          <s-box padding="base" borderWidth="base" borderRadius="base">
            <strong>Created</strong>
            <br />
            {new Date(sale.createdAt).toLocaleDateString()}
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading={`Products on Sale (${sale.variants.length} variants)`}>
        <s-box>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={{ textAlign: "left", padding: "8px" }}>Variant ID</th>
                <th style={{ textAlign: "right", padding: "8px" }}>
                  Original Price
                </th>
                <th style={{ textAlign: "right", padding: "8px" }}>Sale Price</th>
                <th style={{ textAlign: "right", padding: "8px" }}>Savings</th>
              </tr>
            </thead>
            <tbody>
              {sale.variants.map((variant) => {
                const original = parseFloat(variant.originalPrice);
                const salePrice = parseFloat(variant.salePrice);
                const savings = original - salePrice;

                return (
                  <tr
                    key={variant.id}
                    style={{ borderBottom: "1px solid #eee" }}
                  >
                    <td style={{ padding: "8px" }}>
                      {variant.variantId.split("/").pop()}
                    </td>
                    <td style={{ textAlign: "right", padding: "8px" }}>
                      <span
                        style={{
                          textDecoration:
                            sale.status === "active" ? "line-through" : "none",
                        }}
                      >
                        ${original.toFixed(2)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", padding: "8px" }}>
                      <strong style={{ color: "green" }}>
                        ${salePrice.toFixed(2)}
                      </strong>
                    </td>
                    <td style={{ textAlign: "right", padding: "8px" }}>
                      <span style={{ color: "green" }}>${savings.toFixed(2)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #ddd" }}>
                <td style={{ padding: "8px" }}>
                  <strong>Total</strong>
                </td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  <strong>${totalOriginal.toFixed(2)}</strong>
                </td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  <strong>${totalSale.toFixed(2)}</strong>
                </td>
                <td style={{ textAlign: "right", padding: "8px" }}>
                  <strong style={{ color: "green" }}>
                    ${totalSavings.toFixed(2)}
                  </strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Quick Stats">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <strong>Average discount per item:</strong>
            <br />$
            {sale.variants.length > 0
              ? (totalSavings / sale.variants.length).toFixed(2)
              : "0.00"}
          </s-paragraph>
          <s-paragraph>
            <strong>Total savings for customers:</strong>
            <br />${totalSavings.toFixed(2)}
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
