import { useState, useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

interface ProductVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
}

interface Product {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: {
    edges: Array<{
      node: ProductVariant;
    }>;
  };
}

interface ProductsResponse {
  products: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    edges: Array<{
      node: Product;
    }>;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const search = url.searchParams.get("search") || "";

  const query = search ? `title:*${search}*` : "";

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
            featuredImage {
              url
            }
            variants(first: 100) {
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
        first: 25,
        after: cursor,
        query: query || null,
      },
    },
  );

  const data = (await response.json()).data as ProductsResponse;

  return {
    products: data.products.edges.map((e) => e.node),
    pageInfo: data.products.pageInfo,
    search,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const discountType = formData.get("discountType") as string;
  const discountValue = parseFloat(formData.get("discountValue") as string);
  const selectedVariantsJson = formData.get("selectedVariants") as string;

  if (!name || !discountType || isNaN(discountValue) || !selectedVariantsJson) {
    return { error: "Missing required fields" };
  }

  // Parse and validate selected variants JSON
  let selectedVariants: Array<{
    variantId: string;
    productId: string;
    originalPrice: string;
  }>;

  try {
    selectedVariants = JSON.parse(selectedVariantsJson);
  } catch (error) {
    return { error: "Invalid variant data format" };
  }

  // Validate structure
  if (!Array.isArray(selectedVariants)) {
    return { error: "Invalid variant data format" };
  }

  if (selectedVariants.length === 0) {
    return { error: "No variants selected" };
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
    let salePrice: number;

    switch (discountType) {
      case "percentage":
        salePrice = originalPrice * (1 - discountValue / 100);
        break;
      case "fixed_amount":
        salePrice = Math.max(0.01, originalPrice - discountValue);
        break;
      case "fixed_price":
        salePrice = discountValue;
        break;
      default:
        salePrice = originalPrice;
    }

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

  // Apply sale prices via GraphQL
  const errors: string[] = [];
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

  if (errors.length > 0) {
    return { error: `Failed to apply sale: ${errors.join(", ")}` };
  }

  // Save sale to database
  const sale = await db.sale.create({
    data: {
      shop: session.shop,
      name,
      discountType,
      discountValue,
      status: "active",
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

  return { success: true, saleId: sale.id };
};

function calculateSalePrice(
  originalPrice: number,
  discountType: string,
  discountValue: number,
): number {
  switch (discountType) {
    case "percentage":
      return originalPrice * (1 - discountValue / 100);
    case "fixed_amount":
      return Math.max(0.01, originalPrice - discountValue);
    case "fixed_price":
      return discountValue;
    default:
      return originalPrice;
  }
}

export default function NewSale() {
  const { products, pageInfo, search } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("20");
  const [selectedVariants, setSelectedVariants] = useState<
    Map<string, { variantId: string; productId: string; originalPrice: string }>
  >(new Map());
  const [searchInput, setSearchInput] = useState(search);

  const isSubmitting = fetcher.state !== "idle";

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

  const toggleProduct = (product: Product) => {
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

  const handleSubmit = () => {
    if (!name.trim()) {
      shopify.toast.show("Please enter a sale name");
      return;
    }
    if (selectedVariants.size === 0) {
      shopify.toast.show("Please select at least one variant");
      return;
    }

    fetcher.submit(
      {
        name,
        discountType,
        discountValue,
        selectedVariants: JSON.stringify(Array.from(selectedVariants.values())),
      },
      { method: "POST" },
    );
  };

  const handleSearch = () => {
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

  return (
    <s-page heading="Create Sale">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Create Sale ({selectedVariants.size} variants)
      </s-button>

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
            <s-button onClick={handleSearch}>Search</s-button>
          </s-stack>

          {products.length === 0 ? (
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
                                <span style={{ color: "green" }}>
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
            <s-button variant="tertiary" onClick={handleLoadMore}>
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
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
