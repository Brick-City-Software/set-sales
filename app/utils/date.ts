/**
 * Formats a date consistently across the app using en-US locale
 * @param date - Date object or ISO string
 * @returns Formatted date string (e.g., "Jan 30, 2026")
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/**
 * Formats a date with time consistently across the app
 * @param date - Date object or ISO string
 * @returns Formatted date and time string (e.g., "Jan 30, 2026, 3:45 PM")
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
