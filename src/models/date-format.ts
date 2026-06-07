// Supported date display formats.
//
// Stored verbatim in preferences (human-readable, e.g. "YYYY-MM-DD") and mapped
// to date-fns patterns at the formatting edge (see DATE_FNS_PATTERN in
// utils/dates.ts). This is a closed set: the Settings dropdown offers exactly
// these values, and any other value — a hand-edited preferences file or one
// written by a different version — coerces to the default on load rather than
// reaching date-fns, which throws on unrecognized tokens (e.g. "D", "YY").

export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export const DEFAULT_DATE_FORMAT: DateFormat = "YYYY-MM-DD";

export function isDateFormat(value: unknown): value is DateFormat {
  return (
    typeof value === "string" &&
    (DATE_FORMATS as readonly string[]).includes(value)
  );
}

// Load-time normalization. Unknown or malformed values fall back to the default
// so the formatter only ever sees a supported format. Mirrors coerceTimezone.
export function coerceDateFormat(value: unknown): DateFormat {
  return isDateFormat(value) ? value : DEFAULT_DATE_FORMAT;
}
