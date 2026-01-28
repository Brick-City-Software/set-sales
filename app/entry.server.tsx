import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);

  // Add Content Security Policy headers (Issue #37)
  responseHeaders.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' cdn.shopify.com",
      "style-src 'self' 'unsafe-inline' cdn.shopify.com",
      "img-src 'self' data: https:",
      "connect-src 'self' *.shopify.com *.shopifycdn.com",
      "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      "font-src 'self' data:",
    ].join("; ")
  );

  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          // Only log full errors in development (Issue #34)
          if (process.env.NODE_ENV === "production") {
            console.error("Render error occurred", {
              timestamp: new Date().toISOString(),
              url: request.url,
              // Do NOT include: error.stack, error.message, user data
            });
          } else {
            console.error(error);
          }
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
