// User preferences stored as a portable JSON file at any path.
// Controls display and behavior settings.

import { normalizeLanguagePreference, type LanguagePreference } from "../i18n/languages";
import { generateId } from "../utils/ids";
import { singleLine } from "../utils/textCleanup";
import { isKnownTimeZone, SYSTEM_TIME_ZONE } from "../utils/timezone";
import type { TaskListDto } from "./task-list";
import type { PersistedWorkspaceDto } from "./workspace";

export type ThemePreference = "system" | "light" | "dark";

export interface PreferencesDto {
  // Stable identity generated once when the document is created.
  id: string;
  name: string;
  // The interface language: "system" follows the computer's language on every
  // launch; otherwise a supported language tag. An authored setting that travels
  // with the portable document, like the theme.
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

// The known settings sets. Identity is document metadata, never a settings set.
export const PREFERENCE_SET_KEYS = [
  "language", "fontFamily", "theme", "timezone", "kickDistances", "dueSoonDays",
  "handledTasksPageSize", "confirmPermanentDeletions",
] as const satisfies readonly (keyof PreferencesDto)[];
export type PreferenceSetKey = (typeof PREFERENCE_SET_KEYS)[number];

// Keys only a workspace or a task list carries.
const OTHER_DOCUMENT_KEYS = ["openTabs", "recentFiles", "tasks"] as const satisfies
  readonly (keyof PersistedWorkspaceDto | keyof TaskListDto)[];

// User-picked JSON is a preferences document only when it carries its identity
// and no key of another kind of document.
export function isPreferencesDocument(data: unknown): data is Record<string, unknown> & { id: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const candidate = data as Record<string, unknown>;
  return typeof candidate.id === "string"
    && !OTHER_DOCUMENT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(candidate, key));
}

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

export function createDefaultPreferences(name: string): PreferencesDto {
  return { id: generateId(), name, ...builtInPreferenceSets() };
}

// The one check per set, applied where a document is read and where Save
// writes (config-sets-conventions, Reading and healing): a value is valid when
// the normalizer the Settings surface applies would leave it unchanged.
export function isValidPreferenceSet(key: PreferenceSetKey, value: unknown): boolean {
  switch (key) {
    case "language": return value === normalizeLanguagePreference(value);
    case "fontFamily": return typeof value === "string" && value === singleLine(value);
    case "theme": return value === normalizeThemePreference(value);
    case "timezone": return value === SYSTEM_TIME_ZONE || isKnownTimeZone(value);
    case "kickDistances":
      return Array.isArray(value)
        && JSON.stringify(value) === JSON.stringify(normalizeKickDistances(value));
    case "dueSoonDays": return value === normalizeDueSoonDays(value);
    case "handledTasksPageSize": return value === normalizeHandledTasksPageSize(value);
    case "confirmPermanentDeletions": return typeof value === "boolean";
  }
}

// The document Save writes: identity and every set that differs from its
// built-in (config-sets-conventions). An invalid set is refused, not written.
export function preferencesDocument(preferences: PreferencesDto): Record<string, unknown> {
  const builtIn = builtInPreferenceSets();
  const document: Record<string, unknown> = { id: preferences.id, name: preferences.name };
  for (const key of PREFERENCE_SET_KEYS) {
    const value = preferences[key];
    if (!isValidPreferenceSet(key, value)) {
      throw new Error(`Invalid preferences set: ${key}`);
    }
    if (JSON.stringify(value) !== JSON.stringify(builtIn[key])) document[key] = value;
  }
  return document;
}
