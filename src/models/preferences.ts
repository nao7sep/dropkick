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
    kickDistances: [5, 25],
    dueSoonDays: 7,
    handledTasksPageSize: 50,
    backupEnabled: true,
  };
}
