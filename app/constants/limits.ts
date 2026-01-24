/**
 * Application limits and constraints
 */

export const LIMITS = {
  /**
   * Maximum number of variants that can be included in a single sale.
   * This prevents performance issues with bulk GraphQL mutations and
   * ensures reasonable processing times.
   */
  MAX_VARIANTS_PER_SALE: 500,

  /**
   * Maximum sale name length (matches database VARCHAR limit)
   */
  MAX_SALE_NAME_LENGTH: 255,

  /**
   * Maximum discount value for fixed amounts and prices
   */
  MAX_DISCOUNT_AMOUNT: 1000000,
} as const;
