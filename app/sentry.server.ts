import * as Sentry from "@sentry/react";
import { scrubErrorEvent, scrubTransactionEvent } from "./utils/sentryScrub";

let initialized = false;

// Initialize Sentry for server-side error tracking
export function initSentryServer() {
  if (initialized) return;

  Sentry.init({
    dsn: "https://293283fc34213d258bd7be6d4f7e89c2@o4510863856762880.ingest.us.sentry.io/4510863862530048",
    // Don't send IPs, cookies, or user data — the privacy policy promises no
    // merchant personal information reaches Sentry
    sendDefaultPii: false,
    beforeSend: scrubErrorEvent,
    beforeSendTransaction: scrubTransactionEvent,
    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    environment: process.env.NODE_ENV || "development",
  });

  initialized = true;
}
