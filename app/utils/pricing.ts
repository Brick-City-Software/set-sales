/**
 * Calculates the sale price based on discount type and value.
 * @param originalPrice - The original price of the item
 * @param discountType - Type of discount: "percentage", "fixed_amount", or "fixed_price"
 * @param discountValue - The discount value (percentage, dollar amount, or fixed price)
 * @returns The calculated sale price
 */
export function calculateSalePrice(
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

/**
 * Formats a discount type and value into a human-readable string.
 * @param type - Type of discount: "percentage", "fixed_amount", or "fixed_price"
 * @param value - The discount value
 * @returns A formatted string representation of the discount
 */
export function formatDiscountType(type: string, value: number): string {
  switch (type) {
    case "percentage":
      return `${value}% off`;
    case "fixed_amount":
      return `$${value.toFixed(2)} off`;
    case "fixed_price":
      return `$${value.toFixed(2)}`;
    default:
      return String(value);
  }
}
