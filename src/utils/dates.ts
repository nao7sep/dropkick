import { addDays, format, parseISO, isValid } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { conversionTimeZone } from "./timezone";

// Returns the current time as an ISO 8601 UTC string.
export function nowUtc(): string {
  return new Date().toISOString();
}

// Returns today's date as "YYYY-MM-DD" in the given time zone preference.
export function todayInTimezone(timezone: string): string {
  const now = new Date();
  const zone = conversionTimeZone(timezone);
  return zone
    ? formatInTimeZone(now, zone, "yyyy-MM-dd")
    : format(now, "yyyy-MM-dd");
}

// Returns tomorrow's date as "YYYY-MM-DD" in the given timezone.
// The calculation starts from the timezone-adjusted calendar date, then adds one day.
export function tomorrowInTimezone(timezone: string): string {
  const today = parseISO(todayInTimezone(timezone));
  return format(addDays(today, 1), "yyyy-MM-dd");
}

// Formats an ISO 8601 UTC timestamp for display in the user's timezone, with
// the interface language's formatter (the translator's dateTime). An invalid
// zone falls back to the system timezone; an invalid timestamp is shown as
// stored.
export function formatTimestamp(
  isoUtc: string,
  timezone: string,
  dateTime: (date: Date, timeZone: string | null) => string,
): string {
  const date = parseISO(isoUtc);
  if (!isValid(date)) return isoUtc;
  return dateTime(date, conversionTimeZone(timezone) ?? null);
}

// Formats a date-only string ("YYYY-MM-DD") with the interface language's
// formatter (the translator's calendarDate). No timezone conversion — due
// dates are calendar dates, not instants.
export function formatDueDate(
  dateStr: string,
  calendarDate: (year: number, month: number, day: number) => string,
): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;
  return calendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

// Checks if a due date (YYYY-MM-DD) is in the past relative to today in the given timezone.
export function isOverdue(
  dueDate: string,
  timezone: string,
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
  timezone: string,
): boolean {
  if (count <= 0) return false;

  const today = todayInTimezone(timezone);
  const todayDate = parseISO(today);
  const startStr = format(addDays(todayDate, startOffset), "yyyy-MM-dd");
  const endStr = format(addDays(todayDate, startOffset + count - 1), "yyyy-MM-dd");

  return dueDate >= startStr && dueDate <= endStr;
}
