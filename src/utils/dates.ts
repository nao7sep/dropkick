import { addDays, format, parseISO, isValid } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { coerceTimezone } from "./timezone";
import type { DateFormat } from "../models/date-format";

// Maps each supported display format (models/date-format.ts) to its date-fns
// pattern. Typed as Record<DateFormat, …>, so the set is exhaustive: every
// stored value has a defined, valid pattern and date-fns never sees an
// unrecognized token. Adding a format without its pattern is a compile error.
const DATE_FNS_PATTERN: Record<DateFormat, string> = {
  "YYYY-MM-DD": "yyyy-MM-dd",
  "MM/DD/YYYY": "MM/dd/yyyy",
  "DD/MM/YYYY": "dd/MM/yyyy",
};

// Returns the current time as an ISO 8601 UTC string.
export function nowUtc(): string {
  return new Date().toISOString();
}

// Returns today's date as "YYYY-MM-DD" in the given timezone.
// If timezone is null, uses the system timezone.
export function todayInTimezone(timezone: string | null): string {
  const now = new Date();
  const safeTimezone = coerceTimezone(timezone);
  return safeTimezone
    ? formatInTimeZone(now, safeTimezone, "yyyy-MM-dd")
    : format(now, "yyyy-MM-dd");
}

// Returns tomorrow's date as "YYYY-MM-DD" in the given timezone.
// The calculation starts from the timezone-adjusted calendar date, then adds one day.
export function tomorrowInTimezone(timezone: string | null): string {
  const today = parseISO(todayInTimezone(timezone));
  return format(addDays(today, 1), "yyyy-MM-dd");
}

// Formats an ISO 8601 UTC timestamp for display, converted to the user's timezone.
// If timezone is null, uses the system timezone.
export function formatTimestamp(
  isoUtc: string,
  dateFormat: DateFormat,
  timeFormat: "24h" | "12h",
  timezone: string | null,
): string {
  const date = parseISO(isoUtc);
  if (!isValid(date)) return isoUtc;

  const safeTimezone = coerceTimezone(timezone);
  const zoned = safeTimezone ? toZonedTime(date, safeTimezone) : date;
  const timePart = timeFormat === "24h" ? "HH:mm" : "hh:mm a";

  return format(zoned, `${DATE_FNS_PATTERN[dateFormat]} ${timePart}`);
}

// Formats a date-only string ("YYYY-MM-DD") for display using the user's date format.
// No timezone conversion — due dates are calendar dates, not instants.
export function formatDueDate(
  dateStr: string,
  dateFormat: DateFormat,
): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;

  return format(date, DATE_FNS_PATTERN[dateFormat]);
}

// Checks if a due date (YYYY-MM-DD) is in the past relative to today in the given timezone.
export function isOverdue(
  dueDate: string,
  timezone: string | null,
): boolean {
  const today = todayInTimezone(timezone);
  return dueDate < today;
}

// Returns true if dueDate falls within a window of `count` days starting `startOffset` days from today.
// startOffset=0 starts from today; startOffset=1 starts from tomorrow.
// Example: isDueInDayRange(date, 0, 1, tz) matches today only.
// Example: isDueInDayRange(date, 1, 7, tz) matches tomorrow through today+7.
export function isDueInDayRange(
  dueDate: string,
  startOffset: number,
  count: number,
  timezone: string | null,
): boolean {
  if (count <= 0) return false;

  const today = todayInTimezone(timezone);
  const todayDate = parseISO(today);
  const startStr = format(addDays(todayDate, startOffset), "yyyy-MM-dd");
  const endStr = format(addDays(todayDate, startOffset + count - 1), "yyyy-MM-dd");

  return dueDate >= startStr && dueDate <= endStr;
}
