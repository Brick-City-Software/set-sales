/**
 * Shared TypeScript types for Shopify API responses
 */

/**
 * Shopify product variant from GraphQL API
 */
export interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
}

/**
 * Shopify product from GraphQL API
 */
export interface ShopifyProduct {
  id: string;
  title: string;
  featuredImage: { url: string } | null;
  variants: {
    edges: Array<{
      node: ShopifyVariant;
    }>;
  };
}

/**
 * Response from GetProducts GraphQL query
 */
export interface ProductsResponse {
  products: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
    edges: Array<{
      node: ShopifyProduct;
    }>;
  };
}

/**
 * Sale form data for creating a new sale
 */
export interface SaleFormData {
  name: string;
  discountType: "percentage" | "fixed_amount" | "fixed_price";
  discountValue: number;
  selectedVariants: Array<{
    variantId: string;
    productId: string;
    originalPrice: string;
  }>;
}

/**
 * Variant with calculated sale price
 */
export interface VariantWithSalePrice {
  variantId: string;
  productId: string;
  originalPrice: string;
  salePrice: string;
}
