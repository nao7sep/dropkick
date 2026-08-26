// User preferences stored as a portable JSON file at any path.
// Controls display and behavior settings.

import { generateId } from "../utils/ids";

export type ThemePreference = "system" | "light" | "dark";

export interface PreferencesDto {
  version: string;
  // Stable identity for this document. Generated once at creation and
  // materialized on load for legacy files that lack one — see loadPreferences.
  id: string;
  name: string;
  fontFamily: string;
  theme: ThemePreference;
  // NOTE: zoomLevel and sidebarWidth used to live here but are VIEW STATE, not
  // preferences — they moved to AppStateDto / state.json (see models/app-state.ts
  // and persisted-store-separation-conventions). Theme stays: it is an authored
  // appearance SETTING the user chooses, akin to fontFamily, and travels with the
  // portable preferences document.
  timezone: string | null; // IANA timezone e.g. "Asia/Tokyo"; null = system
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
// DEFAULT_KICK_DISTANCES. Applied at every boundary (file load, flush, and the
// Settings field parse) so a hand-edited or legacy file can never feed
// duplicate or over-large values to the "+N" buttons.
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
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function normalizeThemePreference(
  value: unknown,
  legacyDarkMode?: unknown,
): ThemePreference {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }
  if (typeof legacyDarkMode === "boolean") {
    return legacyDarkMode ? "dark" : "light";
  }
  return "system";
}

// Bounds for the two numeric settings. Named here, beside the fields they
// govern, so the Settings inputs and the normalizers cannot disagree.
export const DUE_SOON_DAYS_MIN = 1;
export const DUE_SOON_DAYS_MAX = 365;
export const DUE_SOON_DAYS_DEFAULT = 7;
export const HANDLED_TASKS_PAGE_SIZE_MIN = 10;
export const HANDLED_TASKS_PAGE_SIZE_MAX = 500;
export const HANDLED_TASKS_PAGE_SIZE_DEFAULT = 50;

// Coerces a stored or typed value to a whole number inside [min, max], falling
// back to `fallback` for anything non-numeric. An HTML min/max attribute is a
// hint the browser does not enforce for typed input, so the range has to be
// applied in code or an out-of-range value reaches the field's consumers.
function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(n), min), max);
}

// Normalizes the due-soon window. Applied at every boundary (file load, flush,
// and the Settings field parse) like normalizeKickDistances, because this value
// is fed to date arithmetic: an unbounded one overflows the Date range and
// throws where the caller cannot recover.
export function normalizeDueSoonDays(value: unknown): number {
  return boundedInteger(
    value,
    DUE_SOON_DAYS_MIN,
    DUE_SOON_DAYS_MAX,
    DUE_SOON_DAYS_DEFAULT,
  );
}

// Normalizes the handled-archive page size. Applied at the same three
// boundaries: this value is a slice length, and a negative one silently hides
// rows from the end of the archive instead of paging into it.
export function normalizeHandledTasksPageSize(value: unknown): number {
  return boundedInteger(
    value,
    HANDLED_TASKS_PAGE_SIZE_MIN,
    HANDLED_TASKS_PAGE_SIZE_MAX,
    HANDLED_TASKS_PAGE_SIZE_DEFAULT,
  );
}

// Recognizes a parsed JSON document as a preferences file. This answers "is this
// one of ours?", which is a separate question from "are its fields well-formed?"
// — the loader still shape-checks the fields it finds. Without this gate any
// JSON object passes, takes every field from defaults, and the id write-back
// rewrites it as a preferences document, so picking a neighbouring .json in the
// startup picker destroys it. The test is version plus at least one field only
// this document carries: that rejects a package.json or a workspace while still
// letting mergeWithDefaults heal a document that predates a newly added field.
export function isPreferencesDocument(
  data: unknown,
): data is Partial<PreferencesDto> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const candidate = data as Partial<PreferencesDto> & { darkMode?: unknown };
  if (typeof candidate.version !== "string") {
    return false;
  }
  return (
    candidate.fontFamily !== undefined ||
    candidate.theme !== undefined ||
    candidate.darkMode !== undefined ||
    candidate.kickDistances !== undefined ||
    candidate.dueSoonDays !== undefined ||
    candidate.handledTasksPageSize !== undefined ||
    candidate.confirmPermanentDeletions !== undefined
  );
}

export function createDefaultPreferences(name: string): PreferencesDto {
  return {
    version: "1.0.0",
    id: generateId(),
    name,
    fontFamily: "",
    theme: "system",
    timezone: null,
    kickDistances: [...DEFAULT_KICK_DISTANCES],
    dueSoonDays: DUE_SOON_DAYS_DEFAULT,
    handledTasksPageSize: HANDLED_TASKS_PAGE_SIZE_DEFAULT,
    confirmPermanentDeletions: true,
  };
}
