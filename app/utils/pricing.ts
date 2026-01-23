/**
 * Calculate the sale price based on discount type and value
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
 * Format discount type and value for display
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
