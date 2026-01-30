import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
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

  return (
    <s-page heading="Dashboard">
      <Link to="/app/sales/new" slot="primary-action">
        <s-button>Create Sale</s-button>
      </Link>

      <s-stack gap="large">
        {/* Statistics Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <s-section>
            <s-stack gap="small">
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                {stats.activeSalesCount}
              </div>
              <div style={{ color: "#6d7175" }}>Active Sales</div>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack gap="small">
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                {stats.totalVariantsOnSale}
              </div>
              <div style={{ color: "#6d7175" }}>Variants on Sale</div>
            </s-stack>
          </s-section>

          <s-section>
            <s-stack gap="small">
              <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                ${stats.totalSavings.toFixed(2)}
              </div>
              <div style={{ color: "#6d7175" }}>Total Savings Offered</div>
            </s-stack>
          </s-section>
        </div>

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
            <s-table variant="auto">
              <s-table-header>
                <s-table-header-row>
                  <s-table-header>Name</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Discount</s-table-header>
                  <s-table-header>Variants</s-table-header>
                  <s-table-header>Created</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>
              </s-table-header>
              <s-table-body>
                {recentSales.map((sale) => (
                  <s-table-row key={sale.id}>
                    <s-table-cell>
                      <Link to={`/app/sales/${sale.id}`}>
                        <s-link>{sale.name}</s-link>
                      </Link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={sale.status === "active" ? "success" : "neutral"}
                      >
                        {sale.status}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {formatDiscountType(sale.discountType, sale.discountValue)}
                    </s-table-cell>
                    <s-table-cell>{sale.variants.length}</s-table-cell>
                    <s-table-cell>
                      {new Date(sale.createdAt).toLocaleDateString()}
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
