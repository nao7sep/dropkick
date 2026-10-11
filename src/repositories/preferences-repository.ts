// Owns the single app-wide settings collection. Legacy portable documents are
// read once during adoption and are never rewritten, renamed or deleted.
import type { PreferencesDto } from "../models";
import {
  createDefaultPreferences, isV010Document,
  isValidPreferenceSet, PREFERENCE_SET_KEYS, preferencesDocument,
} from "../models";
import { appPaths, readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

export type LoadPreferencesResult =
  | { status: "success"; preferences: PreferencesDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

function effectivePreferences(data: Record<string, unknown>, path: string): PreferencesDto {
  const preferences = createDefaultPreferences();
  for (const key of PREFERENCE_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (!isValidPreferenceSet(key, value)) {
      log.warn("preferences set is invalid; using built-in", { path, key });
      continue;
    }
    Object.assign(preferences, { [key]: value });
  }
  return preferences;
}

function isSettings(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    && Object.keys(data).every((key) => key === "formatVersion" || PREFERENCE_SET_KEYS.some((known) => key === known));
}

// The supported old file formats, used only by the one-time adoption below.
export async function loadLegacyPreferences(path: string): Promise<LoadPreferencesResult> {
  const result = await readJsonFileResult<unknown>(path, "preferences");
  if (result.status !== "success") return result;
  const data = isV010Document(result.data) && isV010PreferencesCandidate(result.data)
    ? fromV010Preferences(result.data) : result.data;
  if (!isPreferencesDocument(data)) return { status: "invalid", message: "not a preferences document" };
  return { status: "success", preferences: effectivePreferences(data, path) };
}

export async function initializePreferences(): Promise<LoadPreferencesResult & { filePath: string }> {
  const { settingsFile, stateFile, preferencesFile } = await appPaths();
  const result = await readJsonFileResult<unknown>(settingsFile, "settings");
  if (result.status === "success") {
    return isSettings(result.data)
      ? { status: "success", preferences: effectivePreferences(result.data, settingsFile), filePath: settingsFile }
      : { status: "invalid", message: "unrecognized app settings", filePath: settingsFile };
  }
  if (result.status !== "missing") return { ...result, filePath: settingsFile };

  // Run before view-state initialization can retire the old selected paths.
  // A selected but unavailable source is a visible startup failure, never
  // permission to replace that user's choices with defaults.
  const state = await readJsonFileResult<unknown>(stateFile, "state");
  if (state.status === "error" || state.status === "newer") return { ...state, filePath: stateFile };
  const data = state.status === "success" && typeof state.data === "object" && state.data !== null
    ? state.data as Record<string, unknown> : {};
  const selected = [data.lastLaunchedPreferencesPath, data.lastPreferencesPath]
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const source = selected ?? preferencesFile;
  const legacy = await loadLegacyPreferences(source);
  if (legacy.status === "missing" && !selected) {
    return { status: "success", preferences: createDefaultPreferences(), filePath: settingsFile };
  }
  if (legacy.status !== "success") return { ...legacy, filePath: source };
  // Persist even an empty imported map: this records adoption so a later launch
  // cannot re-import an old file after the user resets all app-wide settings.
  try {
    await flushPreferences(settingsFile, () => legacy.preferences);
  } catch (error) {
    log.warn("settings adoption could not be saved", { path: settingsFile });
    return { status: "error", message: String(error), filePath: settingsFile };
  }
  return { ...legacy, filePath: settingsFile };
}

export async function flushPreferences(path: string, getPreferences: () => PreferencesDto): Promise<void> {
  return withSerial(path, async () => {
    const result = await readJsonFileResult<unknown>(path, "settings");
    if (result.status !== "missing" && (result.status !== "success" || !isSettings(result.data))) {
      throw new Error("Cannot save unavailable app settings");
    }
    await writeJsonFile(path, "settings", preferencesDocument(getPreferences()));
  });
}

// Keys only a workspace or a task list carries.
const OTHER_DOCUMENT_KEYS = ["openTabs", "recentFiles", "tasks"] as const;

// Legacy preferences carry a name/identity and no workspace or task-list keys.
function isPreferencesDocument(
  data: unknown,
): data is Record<string, unknown> & { id: string; name: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const candidate = data as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && !OTHER_DOCUMENT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(candidate, key));
}

// Only values whose meaning is unchanged are imported from v0.1.0.
function isV010PreferencesCandidate(data: Record<string, unknown>): boolean {
  return typeof data.name === "string"
    && !OTHER_DOCUMENT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(data, key));
}

function fromV010Preferences(data: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {
    id: typeof data.id === "string" && data.id !== "" ? data.id : "",
    name: data.name,
  };
  if (data.darkMode === true) converted.theme = "dark";
  if (typeof data.timezone === "string") converted.timezone = data.timezone;
  if (typeof data.fontFamily === "string" && data.fontFamily !== "system-ui") {
    converted.fontFamily = data.fontFamily;
  }
  for (const key of ["kickDistances", "dueSoonDays", "handledTasksPageSize"] as const) {
    if (Object.prototype.hasOwnProperty.call(data, key)) converted[key] = data[key];
  }
  return converted;
}
