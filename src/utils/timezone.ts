// Time zone preference helpers. The preference is the token "system", its
// built-in, or an IANA id (config-sets-conventions).

export const SYSTEM_TIME_ZONE = "system";

// Whether the platform knows the IANA id.
export function isKnownTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The IANA id to convert into, or undefined for the computer's own zone.
export function conversionTimeZone(preference: string): string | undefined {
  return preference !== SYSTEM_TIME_ZONE && isKnownTimeZone(preference) ? preference : undefined;
}

// The zones the Settings list offers after System: every IANA zone the
// platform knows, plus UTC and the saved zone when the platform's list lacks
// them, so a stored choice always stays selectable.
export function timeZoneOptions(saved: string): string[] {
  const zones = new Set(Intl.supportedValuesOf("timeZone"));
  zones.add("UTC");
  if (saved !== SYSTEM_TIME_ZONE) zones.add(saved);
  return [...zones].sort();
}

// The computer's zone, which System follows; UTC when the platform cannot say.
export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
