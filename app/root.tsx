import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import { initSentry } from "./sentry.client";

export const loader = () => {
  return { apiKey: process.env.SHOPIFY_API_KEY ?? "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  useEffect(() => {
    // Initialize Sentry on client-side mount
    if (typeof window !== "undefined") {
      initSentry();
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        {/* App Bridge must be in <head> before other scripts (Req 2.2.3) */}
        {apiKey && <meta name="shopify-api-key" content={apiKey} />}
        {apiKey && (
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        )}
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
