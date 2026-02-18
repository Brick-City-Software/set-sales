import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR compliance webhook: shop/redact
// Triggered 48 hours after a merchant uninstalls the app.
// Delete all shop data: sessions, sales, and sale variants (cascade).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }

  // Delete all sales for this shop (SaleVariants are cascade deleted)
  await db.sale.deleteMany({ where: { shop } });

  // Delete all sessions for this shop
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
