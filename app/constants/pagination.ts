/**
 * Pagination and query limit constants
 */

export const PAGINATION = {
  /**
   * Number of products to fetch per page in product selection
   * Shopify GraphQL API maximum is 250
   */
  PRODUCTS_PER_PAGE: 25,

  /**
   * Number of variants to fetch per product
   * Shopify GraphQL API maximum is 250
   */
  VARIANTS_PER_PRODUCT: 100,

  /**
   * Shopify GraphQL API maximum for `first` parameter
   * @see https://shopify.dev/docs/api/usage/pagination-graphql
   */
  SHOPIFY_MAX_PAGE_SIZE: 250,
} as const;
