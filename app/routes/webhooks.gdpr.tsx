import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
    console.log("Payload:", JSON.stringify(payload));
  }

  // These are mandatory GDPR compliance webhooks.
  // This app does not store personally identifiable customer data beyond
  // what Shopify sessions require, so no additional action is needed.
  // If customer data is stored in the future, handle deletion/export here.
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // A customer requested their data. Respond with any stored customer data.
      // This app does not store customer PII, so no data to return.
      break;
    case "CUSTOMERS_REDACT":
      // A customer requested deletion of their data.
      // This app does not store customer PII, so no data to delete.
      break;
    case "SHOP_REDACT":
      // A shop was uninstalled 48 hours ago. Delete all shop data.
      // Session deletion is handled by the app/uninstalled webhook.
      break;
  }

  return new Response();
};
