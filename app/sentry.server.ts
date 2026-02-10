import * as Sentry from "@sentry/react";

let initialized = false;

// Initialize Sentry for server-side error tracking
export function initSentryServer() {
  if (initialized) return;

  Sentry.init({
    dsn: "https://293283fc34213d258bd7be6d4f7e89c2@o4510863856762880.ingest.us.sentry.io/4510863862530048",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring
    environment: process.env.NODE_ENV || "development",
  });

  initialized = true;
}
