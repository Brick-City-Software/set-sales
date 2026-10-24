import * as Sentry from "@sentry/react";
import { scrubEvent } from "./utils/sentryScrub";

// Initialize Sentry for client-side error tracking
export function initSentry() {
  Sentry.init({
    dsn: "https://293283fc34213d258bd7be6d4f7e89c2@o4510863856762880.ingest.us.sentry.io/4510863862530048",
    // Don't send IPs, cookies, or user data — the privacy policy promises no
    // merchant personal information reaches Sentry
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    // Session Replay is intentionally not enabled: it would record merchant
    // admin screens (product names, prices, staff info)
    integrations: [Sentry.browserTracingIntegration()],
    // Performance Monitoring
    tracesSampleRate: 0.1,
  });
}
