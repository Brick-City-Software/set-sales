/**
 * Database-backed fixed-window rate limiter for sale operations.
 * Counters live in Postgres so limits hold across app instances and restarts.
 */
import * as Sentry from "@sentry/react";
import db from "../db.server";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// Expired rows are harmless (they reset on next use) — prune occasionally
const CLEANUP_PROBABILITY = 0.01;

/**
 * Check if a request is allowed under rate limiting rules
 * @param key - Unique identifier for the rate limit (e.g., "shop:create_sale")
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export async function checkRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const now = new Date();
  const newResetAt = new Date(now.getTime() + config.windowMs);

  try {
    // Single atomic statement: start a new window if the old one expired,
    // otherwise increment the counter.
    const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${newResetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."resetAt" <= ${now}
                       THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now}
                         THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt"`;

    if (Math.random() < CLEANUP_PROBABILITY) {
      db.rateLimit
        .deleteMany({ where: { resetAt: { lt: now } } })
        .catch((error) => Sentry.captureException(error));
    }

    const { count, resetAt } = rows[0];
    return {
      allowed: count <= config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetAt: resetAt.getTime(),
    };
  } catch (error) {
    // Fail open: a rate limiter outage shouldn't block merchants
    Sentry.captureException(error, { extra: { context: "rate_limit", key } });
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: newResetAt.getTime(),
    };
  }
}

/**
 * Delete all rate limit counters for a shop (used on shop/redact)
 */
export async function deleteRateLimitsForShop(shop: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: `${shop}:` } } });
}
