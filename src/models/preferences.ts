// User preferences stored as a portable JSON file at any path.
// Controls display, date/time formatting, and behavior settings.

export interface PreferencesDto {
  version: string;
  name: string;
  fontFamily: string;
  zoomLevel: number; // 0.5–2.0 (1.0 = 100%)
  sidebarWidth: number; // pixels (160–1280)
  dateFormat: string;
  timeFormat: "24h" | "12h";
  timezone: string | null; // IANA timezone e.g. "Asia/Tokyo"; null = system
  kickDistances: number[];
  handledTasksPageSize: number;
  backupEnabled: boolean;
}

export function createDefaultPreferences(name: string): PreferencesDto {
  return {
    version: "1.0.0",
    name,
    fontFamily: "system-ui",
    zoomLevel: 1.0,
    sidebarWidth: 320,
    dateFormat: "YYYY-MM-DD",
    timeFormat: "24h",
    timezone: null,
    kickDistances: [5, 25],
    handledTasksPageSize: 50,
    backupEnabled: true,
  };
}
