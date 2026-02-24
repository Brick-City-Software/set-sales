import type { ActionFunctionArgs } from "react-router";
import * as Sentry from "@sentry/react";
import { authenticate, apiVersion } from "../shopify.server";
import db from "../db.server";

const RESTORE_MUTATION = `
  mutation RestoreOriginalPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors {
        field
        message
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  // Only log webhook info in development (Issue #34)
  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }

  // Look up the offline session directly from the DB to get the access token.
  // We bypass unauthenticated.admin() because with expiringOfflineAccessTokens
  // enabled it tries to refresh the token — which fails at uninstall time since
  // Shopify has already revoked it. Using the stored token directly still works
  // for the brief window between uninstall and full revocation.
  const session = await db.session.findFirst({
    where: { shop, isOnline: false },
    select: { accessToken: true },
  });

  if (session?.accessToken) {
    const accessToken = session.accessToken;
    const graphqlEndpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

    const activeSales = await db.sale.findMany({
      where: { shop, status: { in: ["active", "ending"] } },
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
          const response = await fetch(graphqlEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({
              query: RESTORE_MUTATION,
              variables: { productId, variants },
            }),
          });

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
  } else {
    Sentry.captureException(
      new Error(`No offline session found for shop ${shop} during uninstall`),
      { extra: { shop, context: "uninstall_no_session" } },
    );
  }

  // Delete sessions regardless of price restoration outcome
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
