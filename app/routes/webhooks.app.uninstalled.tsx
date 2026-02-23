import type { ActionFunctionArgs } from "react-router";
import * as Sentry from "@sentry/react";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  // Only log webhook info in development (Issue #34)
  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }

  // Use unauthenticated.admin so price restoration works even when
  // authenticate.webhook returns no session (e.g. duplicate delivery or
  // token already partially revoked by Shopify at uninstall time).
  try {
    const { admin } = await unauthenticated.admin(shop);

    const activeSales = await db.sale.findMany({
      where: { shop, status: "active" },
      include: { variants: true },
    });

    for (const sale of activeSales) {
      try {
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
        for (const [productId, variants] of variantsByProduct) {
          const response = await admin.graphql(
            `#graphql
            mutation RestoreOriginalPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                userErrors {
                  field
                  message
                }
              }
            }`,
            { variables: { productId, variants } },
          );

          const result = await response.json();
          const userErrors =
            result.data?.productVariantsBulkUpdate?.userErrors || [];
          if (userErrors.length > 0) {
            Sentry.captureException(
              new Error(
                `Failed to restore prices on uninstall for product ${productId}: ${userErrors.map((e: { message: string }) => e.message).join(", ")}`,
              ),
              { extra: { shop, saleId: sale.id } },
            );
          }
        }
      } catch (error) {
        Sentry.captureException(error, {
          extra: { shop, saleId: sale.id, context: "uninstall_price_restore" },
        });
      }
    }
  } catch (error) {
    // If the session no longer exists (e.g. webhook delivered after cleanup),
    // there is nothing to restore — log and continue to session deletion.
    Sentry.captureException(error, {
      extra: { shop, context: "uninstall_fetch_active_sales" },
    });
  }

  // Delete sessions regardless of price restoration outcome
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
