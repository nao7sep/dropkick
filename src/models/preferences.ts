// User preferences stored as a portable JSON file at any path.
// Controls display, date/time formatting, and behavior settings.

import type { DateFormat } from "./date-format";
import { DEFAULT_DATE_FORMAT } from "./date-format";

export interface PreferencesDto {
  version: string;
  name: string;
  fontFamily: string;
  darkMode: boolean; // false = light theme (default), true = dark theme
  zoomLevel: number; // 0.5–5.0 (1.0 = 100%)
  sidebarWidth: number; // pixels (160–1280)
  dateFormat: DateFormat; // one of DATE_FORMATS; see models/date-format.ts
  timeFormat: "24h" | "12h";
  timezone: string | null; // IANA timezone e.g. "Asia/Tokyo"; null = system
  kickDistances: number[];
  dueSoonDays: number;
  handledTasksPageSize: number;
  backupEnabled: boolean;
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
    name,
    fontFamily: "system-ui",
    darkMode: false,
    zoomLevel: 1.0,
    sidebarWidth: 320,
    dateFormat: DEFAULT_DATE_FORMAT,
    timeFormat: "24h",
    timezone: null,
    kickDistances: [...DEFAULT_KICK_DISTANCES],
    dueSoonDays: 7,
    handledTasksPageSize: 50,
    backupEnabled: true,
  };
}
