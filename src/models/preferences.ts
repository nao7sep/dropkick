// One app-wide collection of user preferences.
// Controls display and behavior settings.

import { normalizeLanguagePreference, type LanguagePreference } from "../i18n/languages";
import { singleLine } from "../utils/textCleanup";
import { isKnownTimeZone, SYSTEM_TIME_ZONE } from "../utils/timezone";

export type ThemePreference = "system" | "light" | "dark";

export interface PreferencesDto {
  // The interface language: "system" follows the computer's language on every
  // launch; otherwise a supported language tag.
  language: LanguagePreference;
  fontFamily: string;
  theme: ThemePreference;
  // SYSTEM_TIME_ZONE follows the computer's zone; otherwise an IANA id.
  timezone: string;
  kickDistances: number[];
  dueSoonDays: number;
  handledTasksPageSize: number;
  confirmPermanentDeletions: boolean;
}

// Default kick distances — the single source of truth for the "+N" actions.
// Used by createDefaultPreferences and as the fallback when normalization finds
// no usable values.
export const DEFAULT_KICK_DISTANCES: readonly number[] = [5, 25];

// Normalizes a kick-distances value into a clean, ordered list: positive
// integers only, each truncated and clamped to 999, de-duplicated, original
// order preserved. Non-arrays and empty results fall back to
// DEFAULT_KICK_DISTANCES. Settings input uses this normalization. Stored load
// replaces an invalid whole set with its built-in value; persistence refuses
// invalid sets.
export function normalizeKickDistances(values: unknown): number[] {
  const list = Array.isArray(values) ? values : [];
  const cleaned = list
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
    .map((n) => Math.min(Math.trunc(n), 999));
  const deduplicated = [...new Set(cleaned)];
  return deduplicated.length > 0 ? deduplicated : [...DEFAULT_KICK_DISTANCES];
}

// The UI font stack the app falls back to, and the value the default
// preferences carry. Kept in lock-step with the --font-ui fallback in App.css:
// a family the user types is appended to this, so an unknown one degrades to a
// real sans face rather than the engine's serif.
export const DEFAULT_UI_FONT_STACK =
  'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function normalizeThemePreference(
  value: unknown,
): ThemePreference {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  return "system";
}

// Bounds for the two numeric settings. Named here, beside the fields they
// govern, so the Settings inputs and admission cannot disagree.
export const DUE_SOON_DAYS_MIN = 1;
export const DUE_SOON_DAYS_MAX = 365;
export const DUE_SOON_DAYS_DEFAULT = 7;
export const HANDLED_TASKS_PAGE_SIZE_MIN = 10;
export const HANDLED_TASKS_PAGE_SIZE_MAX = 500;
export const HANDLED_TASKS_PAGE_SIZE_DEFAULT = 50;

// Shared admission rule for numeric settings; raw form text is parsed before
// this boundary and a stored value is never coerced into a different number.
function isBoundedInteger(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// The app-wide settings sets.
export const PREFERENCE_SET_KEYS = [
  "language", "fontFamily", "theme", "timezone", "kickDistances", "dueSoonDays",
  "handledTasksPageSize", "confirmPermanentDeletions",
] as const satisfies readonly (keyof PreferencesDto)[];
export type PreferenceSetKey = (typeof PREFERENCE_SET_KEYS)[number];

export type PreferenceSets = Pick<PreferencesDto, PreferenceSetKey>;

// The sets in `changes` that differ from `current`, compared whole, including
// lists. The one decision of what a preferences update changes.
export function changedPreferenceSets(
  changes: Partial<PreferenceSets>,
  current: PreferencesDto,
): Partial<PreferenceSets> {
  return Object.fromEntries(PREFERENCE_SET_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(changes, key)
      && JSON.stringify(changes[key]) !== JSON.stringify(current[key]))
    .map((key) => [key, changes[key]])) as Partial<PreferenceSets>;
}

function builtInPreferenceSets(): PreferenceSets {
  return {
    language: "system",
    fontFamily: "",
    theme: "system",
    timezone: SYSTEM_TIME_ZONE,
    kickDistances: [...DEFAULT_KICK_DISTANCES],
    dueSoonDays: DUE_SOON_DAYS_DEFAULT,
    handledTasksPageSize: HANDLED_TASKS_PAGE_SIZE_DEFAULT,
    confirmPermanentDeletions: true,
  };
}

export function createDefaultPreferences(): PreferencesDto {
  return builtInPreferenceSets();
}

// The one check per set, applied where a document is read and where Save
// writes. Invalid values are refused or replaced as a whole set by the
// storage owner; validation never changes the supplied value.
export function isValidPreferenceSet(key: PreferenceSetKey, value: unknown): boolean {
  switch (key) {
    case "language": return value === normalizeLanguagePreference(value);
    case "fontFamily": return typeof value === "string" && value === singleLine(value);
    case "theme": return value === normalizeThemePreference(value);
    case "timezone": return value === SYSTEM_TIME_ZONE || isKnownTimeZone(value);
    case "kickDistances":
      return Array.isArray(value)
        && JSON.stringify(value) === JSON.stringify(normalizeKickDistances(value));
    case "dueSoonDays": return isBoundedInteger(value, DUE_SOON_DAYS_MIN, DUE_SOON_DAYS_MAX);
    case "handledTasksPageSize": return isBoundedInteger(value, HANDLED_TASKS_PAGE_SIZE_MIN, HANDLED_TASKS_PAGE_SIZE_MAX);
    case "confirmPermanentDeletions": return typeof value === "boolean";
  }
}

// The settings Save writes: every set that differs from its
// built-in (config-sets-conventions). An invalid set is refused, not written.
export function preferencesDocument(preferences: PreferencesDto): Record<string, unknown> {
  const builtIn = builtInPreferenceSets();
  const document: Record<string, unknown> = {};
  for (const key of PREFERENCE_SET_KEYS) {
    const value = preferences[key];
    if (!isValidPreferenceSet(key, value)) {
      throw new Error(`Invalid preferences set: ${key}`);
    }
    if (JSON.stringify(value) !== JSON.stringify(builtIn[key])) document[key] = value;
  }
  return document;
}
