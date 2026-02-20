import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link, useRouteError, isRouteErrorResponse, useNavigation, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import * as Sentry from "@sentry/react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { checkRateLimit } from "../utils/rateLimit";
import { formatDiscountType } from "../utils/pricing";
import { formatDate } from "../utils/date";
import { trackEvent, trackError } from "../utils/analytics";

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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const formData = await request.formData();
  const action = formData.get("action");
  const saleIds = formData.get("saleIds") as string;

  if (action === "endBulk") {
    const saleIdArray = JSON.parse(saleIds);

    // Rate limiting: max 20 sale end operations per minute per shop (Issue #35)
    const rateLimitConfig = {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    };
    const rateLimit = checkRateLimit(`${session.shop}:end_sale`, rateLimitConfig);

    if (!rateLimit.allowed) {
      const resetIn = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      return {
        error: `Too many requests. Please try again in ${resetIn} seconds.`,
      };
    }

    // Additional rate check for bulk operations
    if (saleIdArray.length > rateLimitConfig.maxRequests) {
      return {
        error: `Cannot end more than ${rateLimitConfig.maxRequests} sales at once.`,
      };
    }

    const sales = await db.sale.findMany({
      where: { id: { in: saleIdArray }, shop: session.shop },
      include: { variants: true },
    });

    if (sales.length === 0) {
      return { error: "No sales found" };
    }

    // Filter out already ended sales
    const activeSalesToEnd = sales.filter((s) => s.status === "active");
    if (activeSalesToEnd.length === 0) {
      return { error: "All selected sales are already ended" };
    }

    const results: { saleId: string; success: boolean; error?: string }[] = [];

    for (const sale of activeSalesToEnd) {
      try {
        // Update status to "ending" first to prevent race conditions
        await db.sale.update({
          where: { id: sale.id },
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
          // Rollback: revert to active status
          await db.sale.update({
            where: { id: sale.id },
            data: { status: "active" },
          });
          results.push({
            saleId: sale.id,
            success: false,
            error: errors.join(", "),
          });
        } else {
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

          // Update status to ended
          await db.sale.update({
            where: { id: sale.id },
            data: { status: "ended" },
          });
          results.push({ saleId: sale.id, success: true });
        }
      } catch (error) {
        // On any error, try to revert status
        await db.sale.update({
          where: { id: sale.id },
          data: { status: "active" },
        });
        results.push({
          saleId: sale.id,
          success: false,
          error: error instanceof Error ? error.message : "Failed to end sale",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    const successfulSaleIds = results
      .filter((r) => r.success)
      .map((r) => r.saleId);

    if (successCount > 0 && failureCount === 0) {
      // Track bulk sale end success
      const totalVariantsEnded = activeSalesToEnd
        .filter((s) => results.find((r) => r.saleId === s.id && r.success))
        .reduce((sum, s) => sum + s.variants.length, 0);
      trackEvent({
        name: "sale_ended",
        properties: {
          sale_id: `bulk:${successCount}`,
          variant_count: totalVariantsEnded,
        },
      });

      return {
        success: true,
        message: `Successfully ended ${successCount} sale${successCount > 1 ? "s" : ""}`,
        saleIds: successfulSaleIds,
        isBulk: true,
      };
    } else if (successCount > 0 && failureCount > 0) {
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
  const saleId = formData.get("saleId") as string;

  if (action === "end") {
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

      return { success: true, message: "Sale ended successfully", saleId };
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

  // Undo end sale action (Issue #53)
  if (action === "undoEnd") {
    const saleId = formData.get("saleId") as string;

    // Rate limiting for undo operations
    const rateLimit = checkRateLimit(`${session.shop}:undo_sale`, {
      maxRequests: 20,
      windowMs: 60000, // 1 minute
    });

    if (!rateLimit.allowed) {
      const resetIn = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
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

      return { success: true, message: "Sale reactivated successfully" };
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

export default function SalesIndex() {
  const { sales, searchQuery, statusFilter } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const [confirmEndSale, setConfirmEndSale] = useState<string | null>(null);
  const [selectedSales, setSelectedSales] = useState<string[]>([]);
  const confirmEndModalRef = useRef<HTMLElement & { showOverlay: () => void; hideOverlay: () => void }>(null);
  const confirmBulkModalRef = useRef<HTMLElement & { showOverlay: () => void; hideOverlay: () => void }>(null);
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
            // Undo all successfully ended sales
            saleIds.forEach((saleId: string) => {
              fetcher.submit(
                { action: "undoEnd", saleId },
                { method: "POST" }
              );
            });
          },
        });
      } else {
        shopify.toast.show(message);
      }

      setConfirmEndSale(null);
      confirmEndModalRef.current?.hideOverlay();
      confirmBulkModalRef.current?.hideOverlay();
      setSelectedSales([]);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, fetcher]);

  const handleEndSale = (saleId: string) => {
    setConfirmEndSale(saleId);
    confirmEndModalRef.current?.showOverlay();
  };

  const confirmEndSaleAction = () => {
    if (confirmEndSale) {
      fetcher.submit(
        { action: "end", saleId: confirmEndSale },
        { method: "POST" },
      );
    }
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
    confirmBulkModalRef.current?.showOverlay();
  };

  const confirmBulkEndAction = () => {
    Sentry.startSpan(
      {
        op: "ui.click",
        name: "Bulk End Sales Confirm",
      },
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
      <Link slot="primary-action" to="/app/sales/new">
        <s-button variant="primary">Create Sale</s-button>
      </Link>

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
                  <s-table-header>
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
                      <s-table-header>Name</s-table-header>
                      <s-table-header>Discount</s-table-header>
                      <s-table-header>Variants</s-table-header>
                      <s-table-header>Created</s-table-header>
                      <s-table-header>Actions</s-table-header>
                    </s-table-header-row>
                  </s-table-header>
                  <s-table-body>
                    {activeSales.map((sale) => (
                      <s-table-row key={sale.id} clickDelegate={`checkbox-${sale.id}`}>
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
              </>
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
        </>
      )}

      <s-modal ref={confirmEndModalRef as any} heading="End Sale">
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            ref={(el: HTMLElement | null) => { if (el) el.onclick = () => confirmEndSaleAction(); }}
            {...(isEnding ? { loading: true } : {})}
          >
            End Sale
          </s-button>
          <s-button
            slot="secondary-actions"
            ref={(el: HTMLElement | null) => { if (el) el.onclick = () => { setConfirmEndSale(null); confirmEndModalRef.current?.hideOverlay(); }; }}
          >
            Cancel
          </s-button>
          <s-paragraph>
            Are you sure you want to end this sale? Original prices will be
            restored.
          </s-paragraph>
        </s-modal>
      <s-modal ref={confirmBulkModalRef as any} heading={`End ${selectedSales.length} Sale${selectedSales.length > 1 ? "s" : ""}`}>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            ref={(el: HTMLElement | null) => { if (el) el.onclick = () => confirmBulkEndAction(); }}
            {...(isEnding ? { loading: true } : {})}
          >
            End {selectedSales.length} Sale{selectedSales.length > 1 ? "s" : ""}
          </s-button>
          <s-button
            slot="secondary-actions"
            ref={(el: HTMLElement | null) => { if (el) el.onclick = () => confirmBulkModalRef.current?.hideOverlay(); }}
          >
            Cancel
          </s-button>
          <s-paragraph>
            Are you sure you want to end {selectedSales.length} sale{selectedSales.length > 1 ? "s" : ""}? Original prices will be
            restored for all selected sales.
          </s-paragraph>
        </s-modal>
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
