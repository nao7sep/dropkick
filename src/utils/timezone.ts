// Time zone preference helpers. The preference is the token "system", its
// built-in, or an IANA id (config-sets-conventions).

export const SYSTEM_TIME_ZONE = "system";

// The preference a stored or chosen value reads as: an id the platform knows,
// spelled as the platform resolves it, or the token for anything else.
export function normalizeTimeZonePreference(value: unknown): string {
  if (typeof value !== "string" || value === SYSTEM_TIME_ZONE) {
    return SYSTEM_TIME_ZONE;
  }
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: value })
      .resolvedOptions().timeZone || value;
  } catch {
    return SYSTEM_TIME_ZONE;
  }
}

// The IANA id to convert into, or undefined for the computer's own zone.
export function conversionTimeZone(preference: string): string | undefined {
  const zone = normalizeTimeZonePreference(preference);
  return zone === SYSTEM_TIME_ZONE ? undefined : zone;
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
