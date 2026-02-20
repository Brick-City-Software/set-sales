import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate, Link, useRouteError, isRouteErrorResponse, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import * as Sentry from "@sentry/react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkRateLimit } from "../utils/rateLimit";
import { formatDiscountType } from "../utils/pricing";
import { formatDate } from "../utils/date";
import { trackEvent, trackError } from "../utils/analytics";

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

  // Rate limiting: max 20 sale end operations per minute per shop (Issue #35)
  const rateLimit = checkRateLimit(`${session.shop}:end_sale`, {
    maxRequests: 20,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    const resetIn = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);

    trackEvent({
      name: "rate_limit_exceeded",
      properties: {
        operation: "end_sale",
        reset_in_seconds: resetIn,
      },
    });

    return {
      error: `Too many requests. Please try again in ${resetIn} seconds.`,
    };
  }

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

        trackEvent({
          name: "sale_end_failed",
          properties: {
            error_type: "shopify_api_error",
            sale_id: saleId ?? "",
          },
        });

        return { error: `Failed to restore prices: ${errors.join(", ")}` };
      }

      // Remove metafields from products (Issue #54)
      const productIds = [...new Set(sale.variants.map((v) => v.productId))];
      const metafieldInputs = productIds.map((productId) => ({
        ownerId: productId,
        namespace: "set_sales",
        key: "active_sale_id",
        value: "",
        type: "single_line_text_field",
      }));

      try {
        await admin.graphql(
          `#graphql
          mutation UpdateProductMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: { metafields: metafieldInputs },
          },
        );
      } catch (error) {
        // Log metafield errors but don't fail the sale end
        console.error("Failed to remove metafields:", error);
      }

      // Finally update status to ended
      await db.sale.update({
        where: { id: saleId },
        data: { status: "ended" },
      });

      // Track successful sale end
      trackEvent({
        name: "sale_ended",
        properties: {
          sale_id: saleId ?? "",
          variant_count: sale.variants.length,
        },
      });

      return { success: true, message: "Sale ended successfully", saleId };
    } catch (error) {
      // On any error, try to revert status
      await db.sale.update({
        where: { id: saleId },
        data: { status: sale.status },
      });

      trackError(error, {
        operation: "end_sale",
        sale_id: saleId ?? "",
      });

      return {
        error:
          error instanceof Error ? error.message : "Failed to end sale",
      };
    }
  }

  // Undo end sale action (Issue #53)
  if (action === "undoEnd") {
    // Rate limiting for undo operations
    const undoRateLimit = checkRateLimit(`${session.shop}:undo_sale`, {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    });

    if (!undoRateLimit.allowed) {
      const resetIn = Math.ceil((undoRateLimit.resetAt - Date.now()) / 1000);
      return {
        error: `Too many requests. Please try again in ${resetIn} seconds.`,
      };
    }

    const sale = await db.sale.findFirst({
      where: { id: saleId, shop: session.shop },
      include: { variants: true },
    });

    if (!sale) {
      return { error: "Sale not found" };
    }

    // Can only undo recently ended sales
    if (sale.status !== "ended") {
      return { error: "Sale is not ended" };
    }

    try {
      // Update status to "active" first
      await db.sale.update({
        where: { id: saleId },
        data: { status: "active" },
      });

      // Group variants by product ID
      const variantsByProduct = new Map<
        string,
        { id: string; price: string; compareAtPrice: string }[]
      >();

      for (const variant of sale.variants) {
        const existing = variantsByProduct.get(variant.productId) || [];
        existing.push({
          id: variant.variantId,
          price: variant.salePrice,
          compareAtPrice: variant.originalPrice,
        });
        variantsByProduct.set(variant.productId, existing);
      }

      // Reapply sale prices for each product
      const errors: string[] = [];
      for (const [productId, variants] of variantsByProduct) {
        const response = await admin.graphql(
          `#graphql
          mutation ReapplySalePrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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
        // Rollback: mark as ended again
        await db.sale.update({
          where: { id: saleId },
          data: { status: "ended" },
        });
        return { error: `Failed to reapply sale prices: ${errors.join(", ")}` };
      }

      // Restore metafields on products (Issue #54)
      const productIds = [...new Set(sale.variants.map((v) => v.productId))];
      const metafieldInputs = productIds.map((productId) => ({
        ownerId: productId,
        namespace: "set_sales",
        key: "active_sale_id",
        value: saleId,
        type: "single_line_text_field",
      }));

      try {
        await admin.graphql(
          `#graphql
          mutation UpdateProductMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: { metafields: metafieldInputs },
          },
        );
      } catch (error) {
        // Log metafield errors but don't fail the undo
        console.error("Failed to restore metafields:", error);
      }

      return { success: true, message: "Sale reactivated successfully", undone: true };
    } catch (error) {
      // On any error, try to revert status
      await db.sale.update({
        where: { id: saleId },
        data: { status: "ended" },
      });
      return {
        error:
          error instanceof Error ? error.message : "Failed to undo end sale",
      };
    }
  }

  return { error: "Unknown action" };
};

export default function SaleDetail() {
  const { sale } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const isEnding = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";

  useEffect(() => {
    if (fetcher.data?.success) {
      const message = fetcher.data.message || "Sale ended - prices restored";

      // If this was an undo action, just show success and stay on page
      if (fetcher.data.undone) {
        shopify.toast.show(message);
        setShowConfirmModal(false);
        return;
      }

      // For end sale action, show undo option (Issue #53)
      if (fetcher.data.saleId) {
        shopify.toast.show(message, {
          duration: 5000,
          action: "Undo",
          onAction: () => {
            fetcher.submit(
              { action: "undoEnd" },
              { method: "POST" }
            );
          },
        });
        setShowConfirmModal(false);
        // Don't navigate away immediately - allow user to undo
        setTimeout(() => {
          navigate("/app/sales");
        }, 5000);
      } else {
        shopify.toast.show(message);
        setShowConfirmModal(false);
        navigate("/app/sales");
      }
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, navigate, fetcher]);

  const handleEndSale = () => {
    setShowConfirmModal(true);
  };

  const confirmEndSale = () => {
    Sentry.startSpan(
      {
        op: "ui.click",
        name: "End Sale Confirm",
      },
      (span) => {
        span.setAttribute("sale_id", sale.id);
        span.setAttribute("variant_count", sale.variants.length);

        fetcher.submit({ action: "end" }, { method: "POST" });
      },
    );
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

  if (isLoading) {
    return (
      <s-page heading="Sale Details">
        <s-skeleton-page>
          <s-skeleton-display-text />
          <s-skeleton-body-text lines={8} />
        </s-skeleton-page>
      </s-page>
    );
  }

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
            {formatDate(sale.createdAt)}
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading={`Products on Sale (${sale.variants.length} variants)`}>
        <s-table variant="auto">
          <s-table-header>
            <s-table-header-row>
              <s-table-header>Variant ID</s-table-header>
              <s-table-header>Original Price</s-table-header>
              <s-table-header>Sale Price</s-table-header>
              <s-table-header>Savings</s-table-header>
            </s-table-header-row>
          </s-table-header>
          <s-table-body>
            {sale.variants.map((variant) => {
              const original = parseFloat(variant.originalPrice);
              const salePrice = parseFloat(variant.salePrice);
              const savings = original - salePrice;

              return (
                <s-table-row key={variant.id}>
                  <s-table-cell>
                    {variant.variantId.split("/").pop()}
                  </s-table-cell>
                  <s-table-cell>
                    <span
                      style={{
                        textDecoration:
                          sale.status === "active" ? "line-through" : "none",
                      }}
                    >
                      ${original.toFixed(2)}
                    </span>
                  </s-table-cell>
                  <s-table-cell>
                    <strong style={{ color: "var(--p-color-text-success)" }}>
                      ${salePrice.toFixed(2)}
                    </strong>
                  </s-table-cell>
                  <s-table-cell>
                    <span style={{ color: "var(--p-color-text-success)" }}>${savings.toFixed(2)}</span>
                  </s-table-cell>
                </s-table-row>
              );
            })}
            <s-table-row>
              <s-table-cell>
                <strong>Total</strong>
              </s-table-cell>
              <s-table-cell>
                <strong>${totalOriginal.toFixed(2)}</strong>
              </s-table-cell>
              <s-table-cell>
                <strong>${totalSale.toFixed(2)}</strong>
              </s-table-cell>
              <s-table-cell>
                <strong style={{ color: "var(--p-color-text-success)" }}>
                  ${totalSavings.toFixed(2)}
                </strong>
              </s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
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

      {showConfirmModal && (
        <s-modal heading="End Sale">
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            onClick={confirmEndSale}
            {...(isEnding ? { loading: true } : {})}
          >
            End Sale
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => setShowConfirmModal(false)}
          >
            Cancel
          </s-button>
          <s-paragraph>
            Are you sure you want to end this sale? Original prices will be
            restored.
          </s-paragraph>
        </s-modal>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Error) {
    trackError(error, { operation: "sale_detail_route" });
  }

  return (
    <s-page heading="Error Loading Sale">
      <s-banner tone="critical">
        <s-paragraph>
          {isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : error instanceof Error
            ? error.message
            : "An unexpected error occurred"}
        </s-paragraph>
      </s-banner>
      <Link to="/app/sales">
        <s-button>Back to Sales</s-button>
      </Link>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
