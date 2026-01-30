
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate, registerWebhooks } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Register webhooks after successful authentication (Issue #42)
  // This ensures webhooks are properly registered for new installations
  await registerWebhooks({ session });

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
