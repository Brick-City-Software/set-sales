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
            <s-stack gap="base">
              <s-paragraph>
                You haven't created any sales yet. Create your first sale to
                start offering discounts to your customers.
              </s-paragraph>
              <Link to="/app/sales/new">
                <s-button>Create your first sale</s-button>
              </Link>
            </s-stack>
          ) : (
            <s-box>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #ddd" }}>
                    <th style={{ textAlign: "left", padding: "8px" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>
                      Status
                    </th>
                    <th style={{ textAlign: "left", padding: "8px" }}>
                      Discount
                    </th>
                    <th style={{ textAlign: "left", padding: "8px" }}>
                      Variants
                    </th>
                    <th style={{ textAlign: "left", padding: "8px" }}>
                      Created
                    </th>
                    <th style={{ textAlign: "right", padding: "8px" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale) => (
                    <tr key={sale.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px" }}>
                        <Link to={`/app/sales/${sale.id}`}>
                          <s-link>{sale.name}</s-link>
                        </Link>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <s-badge
                          tone={sale.status === "active" ? "success" : "neutral"}
                        >
                          {sale.status}
                        </s-badge>
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
