import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link, useRouteError, isRouteErrorResponse, useNavigation, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import * as Sentry from "@sentry/react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkRateLimit } from "../utils/rateLimit";
import { formatDiscountType } from "../utils/pricing";
import { formatDate } from "../utils/date";
import { trackEvent, trackError } from "../utils/analytics";
import { endSale, undoEndSale } from "../services/sales.server";
import { z } from "zod";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Parse query parameters for filtering
  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("search") || "";
  const statusFilter = url.searchParams.get("status") || "";

  // Build where clause with filters
  const where: {
    shop: string;
    status?: string | { in: string[] };
    name?: { contains: string; mode: "insensitive" };
  } = {
    shop: session.shop,
  };

  // Apply search filter (case-insensitive name search)
  if (searchQuery) {
    where.name = { contains: searchQuery, mode: "insensitive" };
  }

  // Apply status filter
  if (statusFilter) {
    const statuses = statusFilter.split(",");
    if (statuses.length === 1) {
      where.status = statuses[0];
    } else {
      where.status = { in: statuses };
    }
  }

  const sales = await db.sale.findMany({
    where,
    include: {
      variants: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return { sales, searchQuery, statusFilter };
};

const END_RATE_LIMIT = { maxRequests: 20, windowMs: 60000 }; // 20/min per shop (Issue #35)
const UNDO_RATE_LIMIT = { maxRequests: 20, windowMs: 60000 };

const MAX_BULK_SALES = 20;

const SaleIdsSchema = z
  .array(z.string().min(1).max(64))
  .min(1, "No sales selected")
  .max(MAX_BULK_SALES, `Cannot update more than ${MAX_BULK_SALES} sales at once.`);

/** Parse the JSON-encoded saleIds field. Returns deduped IDs or an error message. */
function parseSaleIds(raw: unknown): string[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    return "Invalid sale selection";
  }
  const validation = SaleIdsSchema.safeParse(parsed);
  if (!validation.success) return validation.error.issues[0].message;
  return [...new Set(validation.data)];
}

function rateLimitMessage(resetAt: number) {
  const resetIn = Math.ceil((resetAt - Date.now()) / 1000);
  return `Too many requests. Please try again in ${resetIn} seconds.`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "endBulk") {
    const saleIdArray = parseSaleIds(formData.get("saleIds"));
    if (typeof saleIdArray === "string") return { error: saleIdArray };

    const rateLimit = await checkRateLimit(`${session.shop}:end_sale`, END_RATE_LIMIT);
    if (!rateLimit.allowed) return { error: rateLimitMessage(rateLimit.resetAt) };

    const results: { saleId: string; success: boolean; variantCount: number }[] = [];
    for (const saleId of saleIdArray) {
      const result = await endSale(admin, session.shop, saleId);
      results.push({
        saleId,
        success: result.ok,
        variantCount: result.ok ? result.variantCount : 0,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;
    const successfulSaleIds = results.filter((r) => r.success).map((r) => r.saleId);

    if (successCount > 0 && failureCount === 0) {
      // Track bulk sale end success
      trackEvent({
        name: "sale_ended",
        properties: {
          sale_id: `bulk:${successCount}`,
          variant_count: results.reduce((sum, r) => sum + r.variantCount, 0),
        },
      });

      return {
        success: true,
        message: `Successfully ended ${successCount} sale${successCount > 1 ? "s" : ""}`,
        saleIds: successfulSaleIds,
        isBulk: true,
      };
    } else if (successCount > 0) {
      return {
        success: true,
        message: `Ended ${successCount} sale${successCount > 1 ? "s" : ""}, but ${failureCount} failed`,
        saleIds: successfulSaleIds,
        isBulk: true,
      };
    } else {
      return { error: "Failed to end all selected sales" };
    }
  }

  // Legacy single sale end support
  const saleId = String(formData.get("saleId") ?? "");

  if (action === "end") {
    const rateLimit = await checkRateLimit(`${session.shop}:end_sale`, END_RATE_LIMIT);
    if (!rateLimit.allowed) return { error: rateLimitMessage(rateLimit.resetAt) };

    const result = await endSale(admin, session.shop, saleId);
    if (!result.ok) return { error: result.error };
    return { success: true, message: "Sale ended successfully", saleId };
  }

  // Undo end sale action (Issue #53)
  if (action === "undoEnd") {
    const rateLimit = await checkRateLimit(`${session.shop}:undo_sale`, UNDO_RATE_LIMIT);
    if (!rateLimit.allowed) return { error: rateLimitMessage(rateLimit.resetAt) };

    const result = await undoEndSale(admin, session.shop, saleId);
    if (!result.ok) return { error: result.error };
    return { success: true, message: "Sale reactivated successfully" };
  }

  // Undo a bulk end in a single request. Submitting one undoEnd per sale
  // through the same fetcher aborted all but the last request.
  if (action === "undoBulk") {
    const saleIdArray = parseSaleIds(formData.get("saleIds"));
    if (typeof saleIdArray === "string") return { error: saleIdArray };

    const rateLimit = await checkRateLimit(`${session.shop}:undo_sale`, UNDO_RATE_LIMIT);
    if (!rateLimit.allowed) return { error: rateLimitMessage(rateLimit.resetAt) };

    let successCount = 0;
    let firstError = "";
    for (const id of saleIdArray) {
      const result = await undoEndSale(admin, session.shop, id);
      if (result.ok) successCount++;
      else firstError ||= result.error;
    }

    const failureCount = saleIdArray.length - successCount;
    if (successCount === 0) {
      return { error: `Failed to undo: ${firstError}` };
    }
    return {
      success: true,
      message:
        failureCount === 0
          ? `Reactivated ${successCount} sale${successCount > 1 ? "s" : ""}`
          : `Reactivated ${successCount} sale${successCount > 1 ? "s" : ""}, but ${failureCount} could not be undone: ${firstError}`,
    };
  }

  return { error: "Unknown action" };
};

export default function SalesIndex() {
  const { sales, searchQuery, statusFilter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedSales, setSelectedSales] = useState<string[]>([]);
  const [localSearchValue, setLocalSearchValue] = useState(searchQuery);
  const [showFilters, setShowFilters] = useState(false);

  // Parse status filter into array
  const selectedStatuses = statusFilter ? statusFilter.split(",") : [];

  // Filter out pending sales (temporary state during creation)
  const activeSales = sales.filter((s) => s.status === "active");
  const endedSales = sales.filter((s) => s.status === "ended");

  const isEnding = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";

  const allSelected = activeSales.length > 0 && selectedSales.length === activeSales.length;
  const someSelected = selectedSales.length > 0 && selectedSales.length < activeSales.length;

  // Has active filters
  const hasFilters = searchQuery || statusFilter;

  useEffect(() => {
    if (fetcher.data?.success) {
      const message = fetcher.data.message || "Sale ended - prices restored";

      // Show undo action for end sale operations (Issue #53)
      if (fetcher.data.saleId && !fetcher.data.isBulk) {
        const saleId = fetcher.data.saleId;
        shopify.toast.show(message, {
          duration: 5000,
          action: "Undo",
          onAction: () => {
            fetcher.submit(
              { action: "undoEnd", saleId },
              { method: "POST" }
            );
          },
        });
      } else if (fetcher.data.saleIds && fetcher.data.isBulk && Array.isArray(fetcher.data.saleIds)) {
        // For bulk operations, show undo for all successful sales
        const saleIds = fetcher.data.saleIds;
        shopify.toast.show(message, {
          duration: 5000,
          action: "Undo",
          onAction: () => {
            // Undo all successfully ended sales in one request — a fetcher
            // aborts its in-flight submission when submitted again
            fetcher.submit(
              { action: "undoBulk", saleIds: JSON.stringify(saleIds) },
              { method: "POST" }
            );
          },
        });
      } else {
        shopify.toast.show(message);
      }

      setSelectedSales([]);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, fetcher]);

  const handleEndSale = (saleId: string) => {
    fetcher.submit({ action: "end", saleId }, { method: "POST" });
  };

  const handleCheckboxChange = (saleId: string, checked: boolean) => {
    setSelectedSales(
      checked
        ? [...selectedSales, saleId]
        : selectedSales.filter((id) => id !== saleId)
    );
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedSales(checked ? activeSales.map((s) => s.id) : []);
  };

  const handleBulkEndSales = () => {
    Sentry.startSpan(
      { op: "ui.click", name: "Bulk End Sales" },
      (span) => {
        span.setAttribute("sale_count", selectedSales.length);

        fetcher.submit(
          { action: "endBulk", saleIds: JSON.stringify(selectedSales) },
          { method: "POST" }
        );
      },
    );
  };

  const handleSearchChange = (value: string) => {
    setLocalSearchValue(value);
  };

  const handleSearchSubmit = () => {
    const params = new URLSearchParams(searchParams);
    if (localSearchValue) {
      params.set("search", localSearchValue);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleStatusFilterChange = (selected: string[]) => {
    const params = new URLSearchParams(searchParams);
    if (selected.length > 0) {
      params.set("status", selected.join(","));
    } else {
      params.delete("status");
    }
    setSearchParams(params);
  };

  const handleClearAllFilters = () => {
    setLocalSearchValue("");
    setSearchParams(new URLSearchParams());
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
      {sales.length === 0 && !hasFilters ? (
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
          <div style={{ marginBottom: "var(--p-space-400)" }}>
            <s-stack direction="block" gap="base">
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link to="/app/sales/new">
                  <s-button variant="primary">Create Sale</s-button>
                </Link>
              </div>
              <s-stack direction="inline" gap="base">
                <div style={{ flex: 1 }}>
                  <s-text-field
                    label="Search sales"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search by sale name"
                    value={localSearchValue}
                    onInput={(e: Event) =>
                      handleSearchChange((e.target as HTMLInputElement).value)
                    }
                  />
                </div>
                <s-button variant="secondary" onClick={handleSearchSubmit}>
                  Search
                </s-button>
                {hasFilters && (
                  <s-button variant="tertiary" onClick={handleClearAllFilters}>
                    Clear filters
                  </s-button>
                )}
                <s-button
                  variant="tertiary"
                  onClick={() => setShowFilters(!showFilters)}
                >
                  {showFilters ? "Hide" : "Show"} filters
                </s-button>
              </s-stack>

              {showFilters && (
                <s-stack direction="inline" gap="base">
                  <div>
                    <strong style={{ display: "block", marginBottom: "var(--p-space-200)" }}>
                      Status
                    </strong>
                    <s-stack direction="block" gap="small-200">
                      <s-checkbox
                        id="filter-active"
                        label="Active"
                        checked={selectedStatuses.includes("active")}
                        onChange={(e: Event) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          const newStatuses = checked
                            ? [...selectedStatuses, "active"]
                            : selectedStatuses.filter((s) => s !== "active");
                          handleStatusFilterChange(newStatuses);
                        }}
                      />
                      <s-checkbox
                        id="filter-ended"
                        label="Ended"
                        checked={selectedStatuses.includes("ended")}
                        onChange={(e: Event) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          const newStatuses = checked
                            ? [...selectedStatuses, "ended"]
                            : selectedStatuses.filter((s) => s !== "ended");
                          handleStatusFilterChange(newStatuses);
                        }}
                      />
                    </s-stack>
                  </div>
                </s-stack>
              )}
            </s-stack>
          </div>

          {sales.length === 0 ? (
            <s-empty-state
              heading="No sales found"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <s-paragraph>
                Try adjusting your search or filters to find what you&apos;re looking for.
              </s-paragraph>
            </s-empty-state>
          ) : (
            <>
              <s-section heading={`Active Sales (${activeSales.length})`}>
            {activeSales.length > 0 && (
              <s-banner tone="warning">
                <s-paragraph>
                  If you plan to uninstall Set Sales, please end all active sales first to restore your original product prices.
                </s-paragraph>
              </s-banner>
            )}
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
              <>
                {selectedSales.length > 0 && (
                  <div style={{ marginBottom: "var(--p-space-400)" }}>
                    <s-stack direction="inline" gap="base">
                      <s-text>
                        {selectedSales.length} sale{selectedSales.length > 1 ? "s" : ""} selected
                      </s-text>
                      <s-button
                        variant="primary"
                        tone="critical"
                        onClick={handleBulkEndSales}
                        {...(isEnding ? { loading: true } : {})}
                      >
                        End {selectedSales.length} sale{selectedSales.length > 1 ? "s" : ""}
                      </s-button>
                      <s-button
                        variant="tertiary"
                        onClick={() => setSelectedSales([])}
                      >
                        Clear selection
                      </s-button>
                    </s-stack>
                  </div>
                )}
                <s-table variant="auto">
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        id="select-all-checkbox"
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={(e: Event) =>
                          handleSelectAll((e.target as HTMLInputElement).checked)
                        }
                      />
                    </s-table-header>
                    <s-table-header listSlot="primary">Name</s-table-header>
                    <s-table-header>Discount</s-table-header>
                    <s-table-header format="numeric">Variants</s-table-header>
                    <s-table-header>Created</s-table-header>
                    <s-table-header>Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {activeSales.map((sale) => (
                      <s-table-row key={sale.id}>
                        <s-table-cell>
                          <s-checkbox
                            id={`checkbox-${sale.id}`}
                            checked={selectedSales.includes(sale.id)}
                            onChange={(e: Event) =>
                              handleCheckboxChange(
                                sale.id,
                                (e.target as HTMLInputElement).checked
                              )
                            }
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <Link to={`/app/sales/${sale.id}`}>
                            <s-link>{sale.name}</s-link>
                          </Link>
                        </s-table-cell>
                        <s-table-cell>{formatDiscountType(sale.discountType, sale.discountValue)}</s-table-cell>
                        <s-table-cell>{sale.variants.length}</s-table-cell>
                        <s-table-cell>{formatDate(sale.createdAt)}</s-table-cell>
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
              </>
            )}
          </s-section>

          {endedSales.length > 0 && (
            <s-section heading={`Past Sales (${endedSales.length})`}>
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">Name</s-table-header>
                  <s-table-header>Discount</s-table-header>
                  <s-table-header format="numeric">Variants</s-table-header>
                  <s-table-header>Created</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {endedSales.map((sale) => (
                    <s-table-row key={sale.id} clickDelegate={`ended-sale-link-${sale.id}`}>
                      <s-table-cell>
                        <Link to={`/app/sales/${sale.id}`}>
                          <s-link id={`ended-sale-link-${sale.id}`}>{sale.name}</s-link>
                        </Link>
                      </s-table-cell>
                      <s-table-cell>{formatDiscountType(sale.discountType, sale.discountValue)}</s-table-cell>
                      <s-table-cell>{sale.variants.length}</s-table-cell>
                      <s-table-cell>{formatDate(sale.createdAt)}</s-table-cell>
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
        </>
      )}

    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Error) {
    trackError(error, { operation: "sales_index_route" });
  }

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
