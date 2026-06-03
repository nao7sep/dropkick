// Timezone validation and canonicalization helpers.

export const INVALID_TIMEZONE_MESSAGE = "Invalid IANA timezone";

export interface TimezoneValidationResult {
  valid: boolean;
  value: string | null;
}

// Validates a user-provided timezone string.
// Empty input means "use system timezone" and is normalized to null.
export function validateTimezone(timezone: unknown): TimezoneValidationResult {
  if (timezone === null || timezone === undefined) {
    return { valid: true, value: null };
  }

  if (typeof timezone !== "string") {
    return { valid: false, value: null };
  }

  const trimmed = timezone.trim();
  if (trimmed === "") {
    return { valid: true, value: null };
  }

  try {
    const canonical = new Intl.DateTimeFormat(undefined, {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;

    return { valid: true, value: canonical || trimmed };
  } catch {
    return { valid: false, value: null };
  }
}

// Best-effort load-time normalization.
// Invalid values fall back to system timezone so the app stays usable.
export function coerceTimezone(timezone: unknown): string | null {
  const result = validateTimezone(timezone);
  return result.valid ? result.value : null;
}

// Save-time normalization.
// Invalid values are rejected instead of being persisted.
export function normalizeTimezoneOrThrow(timezone: unknown): string | null {
  const result = validateTimezone(timezone);
  if (!result.valid) {
    throw new Error(INVALID_TIMEZONE_MESSAGE);
  }
  return result.value;
}
