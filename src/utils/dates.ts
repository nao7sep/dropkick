import { format, parseISO, isValid } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { coerceTimezone } from "./timezone";

// Returns the current time as an ISO 8601 UTC string.
export function nowUtc(): string {
  return new Date().toISOString();
}

// Returns the current time as a Date-like object in the given timezone.
// If timezone is null, uses the system timezone.
// Used internally for calendar-date comparisons (due dates).
function nowInTimezone(timezone: string | null): Date {
  const now = new Date();
  const safeTimezone = coerceTimezone(timezone);
  return safeTimezone ? toZonedTime(now, safeTimezone) : now;
}

// Returns today's date as "YYYY-MM-DD" in the given timezone.
// If timezone is null, uses the system timezone.
export function todayInTimezone(timezone: string | null): string {
  return format(nowInTimezone(timezone), "yyyy-MM-dd");
}

// Formats an ISO 8601 UTC timestamp for display, converted to the user's timezone.
// If timezone is null, uses the system timezone.
export function formatTimestamp(
  isoUtc: string,
  dateFormat: string,
  timeFormat: "24h" | "12h",
  timezone: string | null,
): string {
  const date = parseISO(isoUtc);
  if (!isValid(date)) return isoUtc;

  const safeTimezone = coerceTimezone(timezone);
  const zoned = safeTimezone ? toZonedTime(date, safeTimezone) : date;
  const timePart = timeFormat === "24h" ? "HH:mm" : "hh:mm a";

  // Convert user-facing date format tokens to date-fns tokens.
  // Users configure "YYYY-MM-DD" style, date-fns uses "yyyy-MM-dd".
  const normalizedDateFormat = dateFormat
    .replace(/YYYY/g, "yyyy")
    .replace(/DD/g, "dd");

  return format(zoned, `${normalizedDateFormat} ${timePart}`);
}

// Formats a date-only string ("YYYY-MM-DD") for display using the user's date format.
// No timezone conversion — due dates are calendar dates, not instants.
export function formatDueDate(
  dateStr: string,
  dateFormat: string,
): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;

  const normalizedDateFormat = dateFormat
    .replace(/YYYY/g, "yyyy")
    .replace(/DD/g, "dd");

  return format(date, normalizedDateFormat);
}

// Checks if a due date (YYYY-MM-DD) is in the past relative to today in the given timezone.
export function isOverdue(
  dueDate: string,
  timezone: string | null,
): boolean {
  const today = todayInTimezone(timezone);
  return dueDate < today;
}

// Checks if a due date is within the next N days relative to today in the given timezone.
export function isDueWithinDays(
  dueDate: string,
  days: number,
  timezone: string | null,
): boolean {
  const today = todayInTimezone(timezone);
  if (dueDate <= today) return false; // past due or today — handled separately

  // Build the cutoff date string by adding days to today.
  const todayDate = parseISO(today);
  const cutoff = new Date(todayDate);
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = format(cutoff, "yyyy-MM-dd");

  return dueDate <= cutoffStr;
}
