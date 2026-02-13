import * as Sentry from "@sentry/react";

/**
 * Analytics utility for tracking feature usage, errors, and performance
 * Combines Shopify App Bridge analytics with Sentry telemetry
 */

// Event types for type safety
export type AnalyticsEvent =
  // Sale events
  | { name: "sale_created"; properties: { variant_count: number; discount_type: string; discount_value: number } }
  | { name: "sale_creation_failed"; properties: { error_type: string; variant_count?: number } }
  | { name: "sale_ended"; properties: { sale_id: string; variant_count: number } }
  | { name: "sale_end_failed"; properties: { error_type: string; sale_id: string } }
  | { name: "sale_viewed"; properties: { sale_id: string; status: string } }
  // Product selection events
  | { name: "product_searched"; properties: { query: string; result_count: number } }
  | { name: "variant_selected"; properties: { variant_count: number } }
  | { name: "variant_deselected"; properties: { variant_count: number } }
  // Navigation events
  | { name: "page_viewed"; properties: { page: string } }
  // Error events
  | { name: "graphql_error"; properties: { operation: string; error_message: string } }
  | { name: "rate_limit_exceeded"; properties: { operation: string; reset_in_seconds: number } };

/**
 * Track an analytics event with Sentry
 * @param event - Event name and properties
 */
export function trackEvent(event: AnalyticsEvent): void {
  Sentry.startSpan(
    {
      op: "analytics.event",
      name: event.name,
    },
    (span) => {
      // Add event properties as span attributes
      Object.entries(event.properties).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    },
  );
}

/**
 * Track an error with context
 * @param error - Error object
 * @param context - Additional context about the error
 */
export function trackError(
  error: Error | unknown,
  context: {
    operation: string;
    [key: string]: string | number | boolean;
  },
): void {
  Sentry.captureException(error, {
    extra: context,
  });

  // Also track as analytics event
  trackEvent({
    name: "graphql_error",
    properties: {
      operation: context.operation,
      error_message: error instanceof Error ? error.message : String(error),
    },
  });
}

/**
 * Track performance of an async operation
 * @param operation - Name of the operation
 * @param fn - Async function to measure
 * @param metadata - Additional metadata
 */
export async function trackPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, string | number>,
): Promise<T> {
  return Sentry.startSpan(
    {
      op: "performance.measure",
      name: operation,
    },
    async (span) => {
      // Add metadata as span attributes
      if (metadata) {
        Object.entries(metadata).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }

      try {
        const result = await fn();
        span.setAttribute("success", true);
        return result;
      } catch (error) {
        span.setAttribute("success", false);
        throw error;
      }
    },
  );
}

/**
 * Create a logger instance for structured logging with Sentry
 */
export const logger = {
  trace: (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      level: "debug",
      message,
      data,
    });
  },
  debug: (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      level: "debug",
      message,
      data,
    });
  },
  info: (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      level: "info",
      message,
      data,
    });
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      level: "warning",
      message,
      data,
    });
  },
  error: (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      level: "error",
      message,
      data,
    });
  },
};
