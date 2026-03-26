// User preferences stored as a portable JSON file at any path.
// Controls display, date/time formatting, and behavior settings.

export interface PreferencesDto {
  version: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  dateFormat: string;
  timeFormat: "24h" | "12h";
  timezone: string | null; // IANA timezone e.g. "Asia/Tokyo"; null = system
  kickDistances: number[];
  handledTasksPageSize: number;
}

export function createDefaultPreferences(name: string): PreferencesDto {
  return {
    version: "1.0.0",
    name,
    fontFamily: "system-ui",
    fontSize: 14,
    dateFormat: "YYYY-MM-DD",
    timeFormat: "24h",
    timezone: null,
    kickDistances: [5, 25],
    handledTasksPageSize: 50,
  };
}
