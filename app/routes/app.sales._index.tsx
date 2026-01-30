import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link, useRouteError, isRouteErrorResponse, useNavigation } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkRateLimit } from "../utils/rateLimit";
import { formatDiscountType } from "../utils/pricing";
import { formatDate } from "../utils/date";

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
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [confirmEndSale, setConfirmEndSale] = useState<string | null>(null);

  // Filter out pending sales (temporary state during creation)
  const activeSales = sales.filter((s) => s.status === "active");
  const endedSales = sales.filter((s) => s.status === "ended");

  const isEnding = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Sale ended - prices restored");
      setConfirmEndSale(null);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const handleEndSale = (saleId: string) => {
    setConfirmEndSale(saleId);
  };

  const confirmEndSaleAction = () => {
    if (confirmEndSale) {
      fetcher.submit(
        { action: "end", saleId: confirmEndSale },
        { method: "POST" },
      );
    }
  };

  if (isLoading) {
    return (
      <s-page heading="Sales">
        <s-skeleton-page>
          <s-skeleton-display-text />
          <s-skeleton-body-text lines={8} />
        </s-skeleton-page>
      </s-page>
    );
  }

  return (
    <s-page heading="Sales">
      <Link to="/app/sales/new" slot="primary-action">
        <s-button>Create Sale</s-button>
      </Link>

      {sales.length === 0 ? (
        <s-empty-state
          heading="Create your first sale"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <s-paragraph>
            Put products on sale by adjusting prices and adding compare-at prices.
            Track all your sales in one place.
          </s-paragraph>
          <Link to="/app/sales/new" slot="action">
            <s-button variant="primary">Create Sale</s-button>
          </Link>
        </s-empty-state>
      ) : (
        <>
          <s-section heading={`Active Sales (${activeSales.length})`}>
            {activeSales.length === 0 ? (
              <s-empty-state
                heading="No active sales"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <s-paragraph>
                  You don&apos;t have any active sales right now. Create a new sale to start offering discounts.
                </s-paragraph>
                <Link to="/app/sales/new" slot="action">
                  <s-button variant="primary">Create Sale</s-button>
                </Link>
              </s-empty-state>
            ) : (
              <s-table variant="auto">
                <s-table-header>
                  <s-table-header-row>
                    <s-table-header>Name</s-table-header>
                    <s-table-header>Discount</s-table-header>
                    <s-table-header>Variants</s-table-header>
                    <s-table-header>Created</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                </s-table-header>
                <s-table-body>
                  {activeSales.map((sale) => (
                    <s-table-row key={sale.id}>
                      <s-table-cell>
                        <Link to={`/app/sales/${sale.id}`}>
                          <s-link>{sale.name}</s-link>
                        </Link>
                      </s-table-cell>
                      <s-table-cell>
                        {formatDiscountType(sale.discountType, sale.discountValue)}
                      </s-table-cell>
                      <s-table-cell>{sale.variants.length}</s-table-cell>
                      <s-table-cell>
                        {formatDate(sale.createdAt)}
                      </s-table-cell>
                      <s-table-cell>
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
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>

          {endedSales.length > 0 && (
            <s-section heading={`Past Sales (${endedSales.length})`}>
              <s-table variant="auto">
                <s-table-header>
                  <s-table-header-row>
                    <s-table-header>Name</s-table-header>
                    <s-table-header>Discount</s-table-header>
                    <s-table-header>Variants</s-table-header>
                    <s-table-header>Created</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                </s-table-header>
                <s-table-body>
                  {endedSales.map((sale) => (
                    <s-table-row key={sale.id}>
                      <s-table-cell>
                        <Link to={`/app/sales/${sale.id}`}>
                          <s-link>{sale.name}</s-link>
                        </Link>
                      </s-table-cell>
                      <s-table-cell>
                        {formatDiscountType(sale.discountType, sale.discountValue)}
                      </s-table-cell>
                      <s-table-cell>{sale.variants.length}</s-table-cell>
                      <s-table-cell>
                        {formatDate(sale.createdAt)}
                      </s-table-cell>
                      <s-table-cell>
                        <Link to={`/app/sales/${sale.id}`}>
                          <s-button variant="tertiary">View</s-button>
                        </Link>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </s-section>
          )}
        </>
      )}

      {confirmEndSale && (
        <s-modal heading="End Sale">
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            onClick={confirmEndSaleAction}
            {...(isEnding ? { loading: true } : {})}
          >
            End Sale
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => setConfirmEndSale(null)}
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

  return (
    <s-page heading="Error Loading Sales">
      <s-banner tone="critical">
        <s-paragraph>
          {isRouteErrorResponse(error)
            ? `${error.status} ${error.statusText}`
            : error instanceof Error
            ? error.message
            : "An unexpected error occurred"}
        </s-paragraph>
      </s-banner>
      <Link to="/app">
        <s-button>Back to Dashboard</s-button>
      </Link>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
