import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkRateLimit } from "../utils/rateLimit";
import { formatDiscountType } from "../utils/pricing";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const sales = await db.sale.findMany({
    where: { shop: session.shop },
    include: {
      variants: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return { sales };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Rate limiting: max 20 sale end operations per minute per shop (Issue #35)
  const rateLimit = checkRateLimit(`${session.shop}:end_sale`, {
    maxRequests: 20,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    const resetIn = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
    return {
      error: `Too many requests. Please try again in ${resetIn} seconds.`,
    };
  }

  const formData = await request.formData();
  const action = formData.get("action");
  const saleId = formData.get("saleId") as string;

  if (action === "end") {
    const sale = await db.sale.findFirst({
      where: { id: saleId, shop: session.shop },
      include: { variants: true },
    });

    if (!sale) {
      return { error: "Sale not found" };
    }

    // Prevent duplicate operations (Issue #36)
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
      return { error: `Failed to restore prices: ${errors.join(", ")}` };
    }

    // Update sale status only if all price restorations succeeded
    await db.sale.update({
      where: { id: saleId },
      data: { status: "ended" },
    });

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

export default function SalesIndex() {
  const { sales } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // Filter out pending sales (temporary state during creation)
  const activeSales = sales.filter((s) => s.status === "active");
  const endedSales = sales.filter((s) => s.status === "ended");

  const isEnding = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Sale ended - prices restored");
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const handleEndSale = (saleId: string) => {
    if (confirm("Are you sure you want to end this sale? Original prices will be restored.")) {
      fetcher.submit(
        { action: "end", saleId },
        { method: "POST" },
      );
    }
  };

  return (
    <s-page heading="Sales">
      <Link to="/app/sales/new" slot="primary-action">
        <s-button>Create Sale</s-button>
      </Link>

      {sales.length === 0 ? (
        <s-section heading="No sales yet">
          <s-paragraph>
            Create your first sale to start offering discounts to your
            customers.
          </s-paragraph>
          <Link to="/app/sales/new">
            <s-button>Create your first sale</s-button>
          </Link>
        </s-section>
      ) : (
        <>
          <s-section heading={`Active Sales (${activeSales.length})`}>
            {activeSales.length === 0 ? (
              <s-paragraph>No active sales.</s-paragraph>
            ) : (
              <s-box>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Discount</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Variants</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Created</th>
                      <th style={{ textAlign: "right", padding: "8px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSales.map((sale) => (
                      <tr key={sale.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "8px" }}>
                          <Link to={`/app/sales/${sale.id}`}>
                            <s-link>{sale.name}</s-link>
                          </Link>
                        </td>
                        <td style={{ padding: "8px" }}>
                          {formatDiscountType(sale.discountType, sale.discountValue)}
                        </td>
                        <td style={{ padding: "8px" }}>{sale.variants.length}</td>
                        <td style={{ padding: "8px" }}>
                          {new Date(sale.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: "right", padding: "8px" }}>
                          <s-stack direction="inline" gap="base">
                            <Link to={`/app/sales/${sale.id}`}>
                              <s-button variant="tertiary">View</s-button>
                            </Link>
                            <s-button
                              variant="primary"
                              tone="critical"
                              onClick={() => handleEndSale(sale.id)}
                              {...(isEnding ? { loading: true } : {})}
                            >
                              End Sale
                            </s-button>
                          </s-stack>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-box>
            )}
          </s-section>

          {endedSales.length > 0 && (
            <s-section heading={`Past Sales (${endedSales.length})`}>
              <s-box>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Discount</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Variants</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Created</th>
                      <th style={{ textAlign: "right", padding: "8px" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {endedSales.map((sale) => (
                      <tr key={sale.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "8px" }}>
                          <Link to={`/app/sales/${sale.id}`}>
                            <s-link>{sale.name}</s-link>
                          </Link>
                        </td>
                        <td style={{ padding: "8px" }}>
                          {formatDiscountType(sale.discountType, sale.discountValue)}
                        </td>
                        <td style={{ padding: "8px" }}>{sale.variants.length}</td>
                        <td style={{ padding: "8px" }}>
                          {new Date(sale.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: "right", padding: "8px" }}>
                          <Link to={`/app/sales/${sale.id}`}>
                            <s-button variant="tertiary">View</s-button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-box>
            </s-section>
          )}
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
