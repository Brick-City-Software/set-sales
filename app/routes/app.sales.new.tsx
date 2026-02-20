import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate, useNavigation, useRouteError, isRouteErrorResponse, Link } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { z } from "zod";
import { checkRateLimit } from "../utils/rateLimit";
import { LIMITS } from "../constants/limits";
import type {
  ShopifyProduct,
  ProductsResponse,
} from "../types/shopify";
import { PAGINATION } from "../constants/pagination";
import { calculateSalePrice } from "../utils/pricing";
import * as Sentry from "@sentry/react";
import { trackEvent, trackError, trackPerformance } from "../utils/analytics";

// Validation schemas
const LoaderParamsSchema = z.object({
  cursor: z.string().regex(/^[A-Za-z0-9+/=]*$/, "Invalid cursor format").optional().nullable(),
  search: z.string().max(100, "Search term too long").optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Validate and sanitize inputs (Issue #30, #33)
  const paramsValidation = LoaderParamsSchema.safeParse({
    cursor: url.searchParams.get("cursor"),
    search: url.searchParams.get("search"),
  });

  if (!paramsValidation.success) {
    return {
      products: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      search: "",
    };
  }

  const { cursor, search } = paramsValidation.data;

  // Sanitize search input to prevent GraphQL injection (Issue #30)
  const sanitizedSearch = search
    ? search.replace(/[*"\\]/g, "\\$&").trim()
    : "";

  const query = sanitizedSearch ? `title:*${sanitizedSearch}*` : null;

  const response = await admin.graphql(
    `#graphql
    query GetProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            status
            featuredImage {
              url
            }
            variants(first: ${PAGINATION.VARIANTS_PER_PRODUCT}) {
              edges {
                node {
                  id
                  title
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      }
    }`,
    {
      variables: {
        first: PAGINATION.PRODUCTS_PER_PAGE,
        after: cursor,
        query: query || null,
      },
    },
  );

  const data = (await response.json()).data as ProductsResponse;

  // Filter to only include ACTIVE products (exclude ARCHIVED and DRAFT)
  const activeProducts = data.products.edges
    .map((e) => e.node)
    .filter((product) => product.status === "ACTIVE");

  return {
    products: activeProducts,
    pageInfo: data.products.pageInfo,
    search: search || "",
  };
};

// Validation schema for sale creation (Issue #31, #32)
const SelectedVariantSchema = z.object({
  variantId: z.string().min(1, "Variant ID required"),
  productId: z.string().min(1, "Product ID required"),
  originalPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price format"),
});

const SaleCreationSchema = z
  .object({
    name: z
      .string()
      .min(1, "Sale name required")
      .max(255, "Sale name too long")
      .trim(),
    discountType: z.enum(["percentage", "fixed_amount", "fixed_price"], {
      message: "Invalid discount type",
    }),
    discountValue: z.coerce
      .number()
      .positive("Discount value must be positive")
      .finite("Discount value must be finite")
      .max(1000000, "Discount value too large"),
    selectedVariants: z
      .array(SelectedVariantSchema)
      .min(1, "At least one variant required")
      .max(500, "Too many variants selected"),
  })
  .refine(
    (data) => {
      if (data.discountType === "percentage" && data.discountValue > 100) {
        return false;
      }
      return true;
    },
    { message: "Percentage discount cannot exceed 100%", path: ["discountValue"] }
  );

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Rate limiting: max 10 sale creations per minute per shop (Issue #35)
  const rateLimit = checkRateLimit(`${session.shop}:create_sale`, {
    maxRequests: 10,
    windowMs: 60000, // 1 minute
  });

  if (!rateLimit.allowed) {
    const resetIn = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);

    // Track rate limit exceeded
    trackEvent({
      name: "rate_limit_exceeded",
      properties: {
        operation: "sale_creation",
        reset_in_seconds: resetIn,
      },
    });

    return {
      error: `Too many requests. Please try again in ${resetIn} seconds.`,
    };
  }

  const formData = await request.formData();

  // Parse and validate selectedVariants JSON (Issue #31)
  const selectedVariantsJson = formData.get("selectedVariants") as string;
  let parsedVariants;

  try {
    parsedVariants = JSON.parse(selectedVariantsJson);
  } catch {
    return { error: "Invalid variant data format" };
  }

  // Validate all inputs with comprehensive schema (Issue #32)
  const validationResult = SaleCreationSchema.safeParse({
    name: formData.get("name"),
    discountType: formData.get("discountType"),
    discountValue: formData.get("discountValue"),
    selectedVariants: parsedVariants,
  });

  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0];
    return { error: firstError.message };
  }

  const { name, discountType, discountValue, selectedVariants } =
    validationResult.data;

  // Check for variants already in active sales (race condition prevention)
  const variantIds = selectedVariants.map((v) => v.variantId);
  const existingVariants = await db.saleVariant.findMany({
    where: {
      variantId: { in: variantIds },
      sale: {
        status: "active",
        shop: session.shop,
      },
    },
    include: {
      sale: {
        select: { id: true, name: true },
      },
    },
  });

  if (existingVariants.length > 0) {
    // Get unique variant IDs that are conflicting
    const conflictingVariantIds = new Set(
      existingVariants.map((v) => v.variantId),
    );
    const conflictCount = conflictingVariantIds.size;

    // Get sale names for context
    const saleNames = [
      ...new Set(existingVariants.map((v) => v.sale.name)),
    ].slice(0, 3);
    const saleNamesList = saleNames.join(", ");
    const moreSales = existingVariants.length > saleNames.length;

    return {
      error: `${conflictCount} variant${conflictCount > 1 ? "s are" : " is"} already in active sale${moreSales ? "s" : ""}: ${saleNamesList}${moreSales ? "..." : ""}`,
    };
  }

  // Validate each variant has required fields
  for (const variant of selectedVariants) {
    if (!variant.variantId || !variant.productId || !variant.originalPrice) {
      return { error: "Invalid variant data structure" };
    }
  }

  // Calculate sale prices
  const variantsWithSalePrice = selectedVariants.map((v) => {
    const originalPrice = parseFloat(v.originalPrice);
    const salePrice = calculateSalePrice(
      originalPrice,
      discountType,
      discountValue,
    );

    return {
      ...v,
      salePrice: salePrice.toFixed(2),
    };
  });

  // Group by product for bulk update
  const variantsByProduct = new Map<
    string,
    Array<{ id: string; price: string; compareAtPrice: string }>
  >();

  for (const v of variantsWithSalePrice) {
    const existing = variantsByProduct.get(v.productId) || [];
    existing.push({
      id: v.variantId,
      price: v.salePrice,
      compareAtPrice: v.originalPrice,
    });
    variantsByProduct.set(v.productId, existing);
  }

  // Step 1: Save sale to database with "pending" status
  // This ensures we have a record even if Shopify API fails
  const sale = await db.sale.create({
    data: {
      shop: session.shop,
      name,
      discountType,
      discountValue,
      status: "pending",
      variants: {
        create: variantsWithSalePrice.map((v) => ({
          variantId: v.variantId,
          productId: v.productId,
          originalPrice: v.originalPrice,
          salePrice: v.salePrice,
        })),
      },
    },
  });

  // Step 2: Apply sale prices via GraphQL
  const errors: string[] = [];
  try {
    await trackPerformance(
      "apply_sale_prices",
      async () => {
        for (const [productId, variants] of variantsByProduct) {
          const response = await admin.graphql(
            `#graphql
            mutation ApplySalePrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
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
          const userErrors = result.data?.productVariantsBulkUpdate?.userErrors || [];
          if (userErrors.length > 0) {
            errors.push(...userErrors.map((e: { message: string }) => e.message));
          }
        }
      },
      {
        variant_count: selectedVariants.length,
        product_count: variantsByProduct.size,
      },
    );
  } catch (error) {
    trackError(error, {
      operation: "apply_sale_prices",
      variant_count: selectedVariants.length,
    });
    throw error;
  }

  // Step 3: Handle success or failure
  if (errors.length > 0) {
    // Rollback: Delete the sale from database since Shopify update failed
    await db.sale.delete({ where: { id: sale.id } });

    // Track sale creation failure
    trackEvent({
      name: "sale_creation_failed",
      properties: {
        error_type: "shopify_api_error",
        variant_count: selectedVariants.length,
      },
    });

    return { error: `Failed to apply sale: ${errors.join(", ")}` };
  }

  // Step 4: Set metafields on products to indicate they're on sale (Issue #54)
  const productIds = [...new Set(selectedVariants.map((v) => v.productId))];
  const metafieldInputs = productIds.map((productId) => ({
    ownerId: productId,
    namespace: "set_sales",
    key: "active_sale_id",
    value: sale.id,
    type: "single_line_text_field",
  }));

  try {
    const metafieldResponse = await admin.graphql(
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

    const metafieldResult = await metafieldResponse.json();
    const metafieldErrors = metafieldResult.data?.metafieldsSet?.userErrors || [];

    // Log metafield errors but don't fail the sale creation
    if (metafieldErrors.length > 0) {
      console.error("Metafield update errors:", metafieldErrors);
    }
  } catch (error) {
    // Log metafield errors but don't fail the sale creation
    console.error("Failed to set metafields:", error);
  }

  // Step 5: Mark sale as active after successful price application
  await db.sale.update({
    where: { id: sale.id },
    data: { status: "active" },
  });

  // Track successful sale creation
  trackEvent({
    name: "sale_created",
    properties: {
      variant_count: selectedVariants.length,
      discount_type: discountType,
      discount_value: discountValue,
    },
  });

  return { success: true, saleId: sale.id };
};

export default function NewSale() {
  const { products, pageInfo, search } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("20");
  const [selectedVariants, setSelectedVariants] = useState<
    Map<string, { variantId: string; productId: string; originalPrice: string }>
  >(new Map());
  const [searchInput, setSearchInput] = useState(search);
  const pageRef = useRef<HTMLElement>(null);
  const modalRef = useRef<HTMLElement & { show: () => void; hide: () => void }>(null);

  const isSubmitting = fetcher.state !== "idle";
  const isLoading = navigation.state === "loading";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Sale created successfully!");
      navigate(`/app/sales/${fetcher.data.saleId}`);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify, navigate]);


  const toggleVariant = (
    variantId: string,
    productId: string,
    originalPrice: string,
    isOnSale: boolean,
  ) => {
    if (isOnSale) return; // Don't allow selecting variants already on sale

    setSelectedVariants((prev) => {
      const next = new Map(prev);
      if (next.has(variantId)) {
        next.delete(variantId);
      } else {
        next.set(variantId, { variantId, productId, originalPrice });
      }
      return next;
    });
  };

  const toggleProduct = (product: ShopifyProduct) => {
    const variants = product.variants.edges
      .map((e) => e.node)
      .filter((v) => !v.compareAtPrice); // Exclude variants already on sale

    const allSelected = variants.every((v) => selectedVariants.has(v.id));

    setSelectedVariants((prev) => {
      const next = new Map(prev);
      if (allSelected) {
        variants.forEach((v) => next.delete(v.id));
      } else {
        variants.forEach((v) =>
          next.set(v.id, {
            variantId: v.id,
            productId: product.id,
            originalPrice: v.price,
          }),
        );
      }
      return next;
    });
  };

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      shopify.toast.show("Please enter a sale name");
      return;
    }
    if (selectedVariants.size === 0) {
      shopify.toast.show("Please select at least one variant");
      return;
    }

    modalRef.current?.show();
  }, [name, selectedVariants, shopify]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => {
      const sBtn = pageRef.current?.querySelector('[slot="primary-action"]');
      if (!sBtn) return;
      const handler = () => handleSubmit();
      sBtn.addEventListener("click", handler);
      cleanup = () => sBtn.removeEventListener("click", handler);
    }, 500);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [handleSubmit]);

  const confirmSubmit = () => {
    Sentry.startSpan(
      {
        op: "ui.click",
        name: "Create Sale Submit",
      },
      (span) => {
        span.setAttribute("variant_count", selectedVariants.size);
        span.setAttribute("discount_type", discountType);

        fetcher.submit(
          {
            name,
            discountType,
            discountValue,
            selectedVariants: JSON.stringify(
              Array.from(selectedVariants.values()),
            ),
          },
          { method: "POST" },
        );
      },
    );
  };

  const handleSearch = () => {
    Sentry.startSpan({ op: "ui.click", name: "Product Search" }, () => {
      trackEvent({
        name: "product_searched",
        properties: {
          query: searchInput || "",
          result_count: products.length,
        },
      });
    });

    const params = new URLSearchParams();
    if (searchInput) params.set("search", searchInput);
    navigate(`/app/sales/new?${params.toString()}`);
  };

  const handleLoadMore = () => {
    if (pageInfo.endCursor) {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("cursor", pageInfo.endCursor);
      navigate(`/app/sales/new?${params.toString()}`);
    }
  };

  const discountValueNum = parseFloat(discountValue) || 0;

  const isApproachingLimit =
    selectedVariants.size > LIMITS.MAX_VARIANTS_PER_SALE * 0.8;
  const isOverLimit = selectedVariants.size > LIMITS.MAX_VARIANTS_PER_SALE;

  // Calculate preview data (Issue #55)
  const previewData = Array.from(selectedVariants.values()).map((v) => {
    const originalPrice = parseFloat(v.originalPrice);
    const salePrice = calculateSalePrice(
      originalPrice,
      discountType,
      discountValueNum
    );
    return {
      variantId: v.variantId,
      productId: v.productId,
      originalPrice,
      salePrice,
      savings: originalPrice - salePrice,
    };
  });

  const totalSavings = previewData.reduce((sum, item) => sum + item.savings, 0);
  const avgSavings = previewData.length > 0 ? totalSavings / previewData.length : 0;

  // Group variants by product for preview display
  const variantsByProduct = new Map<string, typeof previewData>();
  for (const item of previewData) {
    const existing = variantsByProduct.get(item.productId) || [];
    existing.push(item);
    variantsByProduct.set(item.productId, existing);
  }

  // Get product details for preview
  const previewProducts = products.filter((p) =>
    variantsByProduct.has(p.id)
  );

  return (
    <s-page ref={pageRef as any} heading="Create Sale">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        {...(isSubmitting ? { loading: true } : {})}
        {...(isOverLimit ? { disabled: true } : {})}
      >
        Create Sale ({selectedVariants.size} variants)
      </s-button>

      {isApproachingLimit && (
        <s-banner tone={isOverLimit ? "critical" : "warning"}>
          {isOverLimit
            ? `You've selected ${selectedVariants.size} variants. Maximum is ${LIMITS.MAX_VARIANTS_PER_SALE}.`
            : `You've selected ${selectedVariants.size} variants. Maximum is ${LIMITS.MAX_VARIANTS_PER_SALE}.`}
        </s-banner>
      )}

      <s-section heading="Sale Details">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Sale Name"
            value={name}
            onInput={(e: Event) => {
              const target = e.target as HTMLInputElement;
              setName(target.value);
            }}
            placeholder="e.g., Summer Clearance"
          />

          <s-stack direction="block" gap="base">
            <strong>Discount Type</strong>
            <s-stack direction="inline" gap="base">
              <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="radio"
                  name="discountType"
                  value="percentage"
                  checked={discountType === "percentage"}
                  onChange={(e) => setDiscountType(e.target.value)}
                />
                Percentage off
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="radio"
                  name="discountType"
                  value="fixed_amount"
                  checked={discountType === "fixed_amount"}
                  onChange={(e) => setDiscountType(e.target.value)}
                />
                Fixed amount off
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="radio"
                  name="discountType"
                  value="fixed_price"
                  checked={discountType === "fixed_price"}
                  onChange={(e) => setDiscountType(e.target.value)}
                />
                Set specific price
              </label>
            </s-stack>
          </s-stack>

          <div>
            <label>
              {discountType === "percentage"
                ? "Discount Percentage"
                : discountType === "fixed_amount"
                  ? "Amount Off ($)"
                  : "Sale Price ($)"}
            </label>
            <br />
            <input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              style={{ padding: "8px", width: "120px" }}
            />
            {discountType === "percentage" ? " %" : ""}
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Select Products">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Search products"
              value={searchInput}
              onInput={(e: Event) => {
                const target = e.target as HTMLInputElement;
                setSearchInput(target.value);
              }}
              placeholder="Search by title..."
            />
            <s-button onClick={handleSearch} {...(isLoading ? { loading: true } : {})}>
              Search
            </s-button>
          </s-stack>

          {isLoading ? (
            <div style={{ padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              <s-spinner size="large" />
              <s-paragraph>Loading products...</s-paragraph>
            </div>
          ) : products.length === 0 ? (
            <s-paragraph>No products found.</s-paragraph>
          ) : (
            <s-box>
              {products.map((product) => {
                const variants = product.variants.edges.map((e) => e.node);
                const selectableVariants = variants.filter(
                  (v) => !v.compareAtPrice,
                );
                const allSelected =
                  selectableVariants.length > 0 &&
                  selectableVariants.every((v) => selectedVariants.has(v.id));
                const someSelected = selectableVariants.some((v) =>
                  selectedVariants.has(v.id),
                );

                return (
                  <s-box
                    key={product.id}
                    padding="base"
                    borderWidth="base"
                    borderRadius="base"
                  >
                    <s-stack direction="block" gap="base">
                      <s-stack direction="inline" gap="base">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => toggleProduct(product)}
                          disabled={selectableVariants.length === 0}
                        />
                        <strong>{product.title}</strong>
                        {selectableVariants.length === 0 && (
                          <s-badge tone="warning">All variants on sale</s-badge>
                        )}
                      </s-stack>

                      <div style={{ paddingLeft: "24px" }}>
                        {variants.map((variant) => {
                          const isOnSale = !!variant.compareAtPrice;
                          const isSelected = selectedVariants.has(variant.id);
                          const originalPrice = parseFloat(variant.price);
                          const salePrice = calculateSalePrice(
                            originalPrice,
                            discountType,
                            discountValueNum,
                          );

                          return (
                            <div
                              key={variant.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "4px 0",
                                opacity: isOnSale ? 0.5 : 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() =>
                                  toggleVariant(
                                    variant.id,
                                    product.id,
                                    variant.price,
                                    isOnSale,
                                  )
                                }
                                disabled={isOnSale}
                              />
                              <span>
                                {variant.title} - ${variant.price}
                              </span>
                              {isOnSale ? (
                                <s-badge tone="warning">Already on sale</s-badge>
                              ) : isSelected ? (
                                <span style={{ color: "var(--p-color-text-success)" }}>
                                  → ${salePrice.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-box>
          )}

          {pageInfo.hasNextPage && (
            <s-button
              variant="tertiary"
              onClick={handleLoadMore}
              {...(isLoading ? { loading: true } : {})}
            >
              Load more products
            </s-button>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Summary">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <strong>Selected variants:</strong> {selectedVariants.size}
          </s-paragraph>
          <s-paragraph>
            <strong>Discount:</strong>{" "}
            {discountType === "percentage"
              ? `${discountValueNum}% off`
              : discountType === "fixed_amount"
                ? `$${discountValueNum.toFixed(2)} off`
                : `$${discountValueNum.toFixed(2)}`}
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-modal ref={modalRef as any} heading="Review Sale">
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={confirmSubmit}
            {...(isSubmitting ? { loading: true } : {})}
          >
            Create Sale
          </s-button>
          <s-button
            slot="secondary-actions"
            onClick={() => modalRef.current?.hide()}
          >
            Back to Edit
          </s-button>

          <s-stack direction="block" gap="base">
            <s-banner>
              <s-paragraph>
                Review the changes below before creating the sale. Once created, prices will be updated immediately.
              </s-paragraph>
            </s-banner>

            <s-section heading="Sale Summary">
              <s-stack direction="block" gap="small-200">
                <s-paragraph>
                  <strong>Sale name:</strong> {name}
                </s-paragraph>
                <s-paragraph>
                  <strong>Discount:</strong>{" "}
                  {discountType === "percentage"
                    ? `${discountValueNum}% off`
                    : discountType === "fixed_amount"
                      ? `$${discountValueNum.toFixed(2)} off`
                      : `$${discountValueNum.toFixed(2)} fixed price`}
                </s-paragraph>
                <s-paragraph>
                  <strong>Variants affected:</strong> {selectedVariants.size}
                </s-paragraph>
                <s-paragraph>
                  <strong>Products affected:</strong> {variantsByProduct.size}
                </s-paragraph>
                <s-paragraph>
                  <strong>Average savings per variant:</strong> ${avgSavings.toFixed(2)}
                </s-paragraph>
                <s-paragraph>
                  <strong>Total savings (all variants):</strong> ${totalSavings.toFixed(2)}
                </s-paragraph>
              </s-stack>
            </s-section>

            <s-section heading="Price Changes">
              <s-stack direction="block" gap="base">
                {previewProducts.map((product) => {
                  const productVariants = variantsByProduct.get(product.id) || [];
                  return (
                    <div key={product.id}>
                      <s-paragraph>
                        <strong>{product.title}</strong>
                      </s-paragraph>
                      <s-table variant="auto">
                        <s-table-header>
                          <s-table-header-row>
                            <s-table-header>Variant</s-table-header>
                            <s-table-header>Original Price</s-table-header>
                            <s-table-header>Sale Price</s-table-header>
                            <s-table-header>Savings</s-table-header>
                          </s-table-header-row>
                        </s-table-header>
                        <s-table-body>
                          {productVariants.map((variant) => {
                            const variantNode = product.variants.edges.find(
                              (e) => e.node.id === variant.variantId
                            )?.node;
                            return (
                              <s-table-row key={variant.variantId}>
                                <s-table-cell>
                                  {variantNode?.title || "Default"}
                                </s-table-cell>
                                <s-table-cell>
                                  ${variant.originalPrice.toFixed(2)}
                                </s-table-cell>
                                <s-table-cell>
                                  ${variant.salePrice.toFixed(2)}
                                </s-table-cell>
                                <s-table-cell>
                                  ${variant.savings.toFixed(2)} (
                                  {((variant.savings / variant.originalPrice) * 100).toFixed(1)}%)
                                </s-table-cell>
                              </s-table-row>
                            );
                          })}
                        </s-table-body>
                      </s-table>
                    </div>
                  );
                })}
              </s-stack>
            </s-section>
          </s-stack>
        </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (error instanceof Error) {
    trackError(error, { operation: "new_sale_route" });
  }

  return (
    <s-page heading="Error Creating Sale">
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
