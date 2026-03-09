import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate, MONTHLY_PLAN } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);

  // Gate all app routes behind an active subscription, except the billing
  // page itself so users can always reach it to resubscribe or view status.
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/app/billing")) {
    await billing.require({
      plans: [MONTHLY_PLAN] as any,
      onFailure: async () =>
        billing.request({
          plan: MONTHLY_PLAN as any,
          isTest: process.env.NODE_ENV !== "production",
          returnUrl: `${process.env.SHOPIFY_APP_URL}/auth?shop=${session.shop}`,
        }),
    });
  }

  // Validate API key is configured (Issue #38)
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SHOPIFY_API_KEY not configured. Check your environment variables."
    );
  }

  // Note: API key is intentionally public and required for @shopify/app-bridge-react
  // It identifies the app but does not provide access without proper authentication
  return { apiKey };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/sales">Sales</s-link>
        <s-link href="/app/billing">Billing</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
