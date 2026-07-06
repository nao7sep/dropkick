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
  zoomLevel: number; // 0.5–5.0 (1.0 = 100%)
  sidebarWidth: number; // sidebar intent width in PIXELS — the width the user last dragged it to; the displayed width is clamp(SIDEBAR_MIN, intent, maxFit) — see DEFAULT_SIDEBAR_WIDTH / clampSidebarWidth in utils/windowSizing
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
    zoomLevel: 1.0,
    sidebarWidth: 320, // sidebar intent width in px; kept in sync with DEFAULT_SIDEBAR_WIDTH (utils/windowSizing)
    timezone: null,
    kickDistances: [...DEFAULT_KICK_DISTANCES],
    dueSoonDays: 7,
    handledTasksPageSize: 50,
  };
}
