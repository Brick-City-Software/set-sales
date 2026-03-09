import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link, useRouteError, isRouteErrorResponse, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
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

  const activeSales = sales.filter((s) => s.status === "active");
  const endedSales = sales.filter((s) => s.status === "ended");

  // Calculate total variants on sale
  const totalVariantsOnSale = activeSales.reduce(
    (sum, sale) => sum + sale.variants.length,
    0
  );

  // Calculate total savings offered (estimated)
  const totalSavings = activeSales.reduce((sum, sale) => {
    return (
      sum +
      sale.variants.reduce((variantSum, variant) => {
        const original = parseFloat(variant.originalPrice);
        const salePrice = parseFloat(variant.salePrice);
        return variantSum + (original - salePrice);
      }, 0)
    );
  }, 0);

  return {
    stats: {
      activeSalesCount: activeSales.length,
      endedSalesCount: endedSales.length,
      totalVariantsOnSale,
      totalSavings,
    },
    recentSales: sales.slice(0, 5),
  };
};

export default function Dashboard() {
  const { stats, recentSales } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  if (isLoading) {
    return (
      <s-page heading="Dashboard">
        <s-skeleton-page>
          <s-skeleton-display-text />
          <s-skeleton-body-text lines={8} />
        </s-skeleton-page>
      </s-page>
    );
  }

  return (
    <s-page heading="Dashboard">
      <Link to="/app/sales/new" slot="primary-action">
        <s-button variant="primary" slot="primary-action">Create Sale</s-button>
      </Link>

      <s-stack gap="large">
        {/* Statistics Cards */}
        <s-grid>
          <s-grid-item>
            <s-section>
              <s-stack gap="small">
                <div style={{ color: "var(--p-color-text-subdued)", fontWeight: "600", textTransform: "uppercase", fontSize: "12px", letterSpacing: "0.05em" }}>Active Sales</div>
                <div style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.activeSalesCount}</div>
              </s-stack>
            </s-section>
          </s-grid-item>

          <s-grid-item>
            <s-section>
              <s-stack gap="small">
                <div style={{ color: "var(--p-color-text-subdued)", fontWeight: "600", textTransform: "uppercase", fontSize: "12px", letterSpacing: "0.05em" }}>Variants on Sale</div>
                <div style={{ fontSize: "24px", fontWeight: "bold" }}>{stats.totalVariantsOnSale}</div>
              </s-stack>
            </s-section>
          </s-grid-item>

          <s-grid-item>
            <s-section>
              <s-stack gap="small">
                <div style={{ color: "var(--p-color-text-subdued)", fontWeight: "600", textTransform: "uppercase", fontSize: "12px", letterSpacing: "0.05em" }}>Total Savings Offered</div>
                <div style={{ fontSize: "24px", fontWeight: "bold" }}>${stats.totalSavings.toFixed(2)}</div>
              </s-stack>
            </s-section>
          </s-grid-item>
        </s-grid>

        {/* Recent Sales */}
        <s-section heading="Recent Sales">
          {recentSales.length === 0 ? (
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
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Status", "Discount", "Variants", "Created", "Actions"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--p-color-border)", color: "var(--p-color-text-subdued)", fontWeight: "600", fontSize: "13px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentSales.map((sale) => (
                  <tr key={sale.id} style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                    <td style={{ padding: "12px" }}>
                      <Link to={`/app/sales/${sale.id}`}>
                        <s-link>{sale.name}</s-link>
                      </Link>
                    </td>
                    <td style={{ padding: "12px" }}>
                      <s-badge tone={sale.status === "active" ? "success" : "neutral"}>
                        {sale.status}
                      </s-badge>
                    </td>
                    <td style={{ padding: "12px" }}>{formatDiscountType(sale.discountType, sale.discountValue)}</td>
                    <td style={{ padding: "12px" }}>{sale.variants.length}</td>
                    <td style={{ padding: "12px" }}>{formatDate(sale.createdAt)}</td>
                    <td style={{ padding: "12px" }}>
                      <Link to={`/app/sales/${sale.id}`}>
                        <s-button variant="tertiary">View</s-button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {recentSales.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <Link to="/app/sales">
                <s-button variant="tertiary">View all sales</s-button>
              </Link>
            </div>
          )}
        </s-section>

        {/* Quick Actions */}
        <s-section heading="Quick Actions">
          <s-stack direction="inline" gap="base">
            <Link to="/app/sales/new">
              <s-button>Create Sale</s-button>
            </Link>
            <Link to="/app/sales">
              <s-button variant="tertiary">Manage Sales</s-button>
            </Link>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  return (
    <s-page heading="Error">
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
        <s-button>Go to Sales</s-button>
      </Link>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
