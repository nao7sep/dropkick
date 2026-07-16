// User preferences stored as a portable JSON file at any path.
// Controls display and behavior settings.

import { generateId } from "../utils/ids";

export interface PreferencesDto {
  version: string;
  // Stable identity for this document. Generated once at creation and
  // materialized on load for legacy files that lack one — see loadPreferences.
  id: string;
  name: string;
  fontFamily: string;
  darkMode: boolean; // false = light theme (default), true = dark theme
  // NOTE: zoomLevel and sidebarWidth used to live here but are VIEW STATE, not
  // preferences — they moved to AppConfigDto / state.json (see models/app-config.ts
  // and persisted-store-separation-conventions). darkMode stays: it is an authored
  // appearance SETTING the user chooses, akin to fontFamily, and travels with the
  // portable preferences document.
  timezone: string | null; // IANA timezone e.g. "Asia/Tokyo"; null = system
  kickDistances: number[];
  dueSoonDays: number;
  handledTasksPageSize: number;
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

export function createDefaultPreferences(name: string): PreferencesDto {
  return {
    version: "1.0.0",
    id: generateId(),
    name,
    fontFamily: "system-ui",
    darkMode: false,
    timezone: null,
    kickDistances: [...DEFAULT_KICK_DISTANCES],
    dueSoonDays: 7,
    handledTasksPageSize: 50,
  };
}
