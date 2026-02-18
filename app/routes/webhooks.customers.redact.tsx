import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR compliance webhook: customers/redact
// A merchant has requested that a customer's data be deleted.
// This app stores no customer PII — only shop-level sale and variant pricing data.
// No customer data to delete; respond with 200 to acknowledge.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }

  return new Response();
};
