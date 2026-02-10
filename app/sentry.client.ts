import * as Sentry from "@sentry/react";

// Initialize Sentry for client-side error tracking
export function initSentry() {
  Sentry.init({
    dsn: "https://293283fc34213d258bd7be6d4f7e89c2@o4510863856762880.ingest.us.sentry.io/4510863862530048",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
    // Enable logs to be sent to Sentry
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring
    // Session Replay
    replaysSessionSampleRate: 0.1, // Sample 10% of sessions
    replaysOnErrorSampleRate: 1.0, // Sample 100% of sessions with errors
  });
}
