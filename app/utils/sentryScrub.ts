import type { Event } from "@sentry/react";

/**
 * Embedded-app URLs carry session tokens and signatures in the query string
 * (id_token, hmac, host, session, ...). Strip the query entirely before any
 * URL is sent to Sentry.
 */
export function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

// Generic so it fits both beforeSend (ErrorEvent) and beforeSendTransaction
// (TransactionEvent); @sentry/react only re-exports the base Event type.
export function scrubEvent<T extends Event>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = stripQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.Authorization;
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
    }
  }
  if (typeof event.extra?.url === "string") {
    event.extra.url = stripQuery(event.extra.url);
  }
  if (event.transaction) event.transaction = stripQuery(event.transaction);
  delete event.user;
  return event;
}
