// Reads and writes preferences files.

import type { PreferencesDto } from "../models";
import { createDefaultPreferences } from "../models";
import { readJsonFileResult, writeJsonFile } from "./file-system";
import { coerceTimezone, normalizeTimezoneOrThrow } from "../utils/timezone";

export type LoadPreferencesResult =
  | { status: "success"; preferences: PreferencesDto }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Loads a preferences file. Missing files fall back to defaults; invalid files
// are reported so the user does not mistake a parse failure for empty settings.
export async function loadPreferences(
  path: string,
): Promise<LoadPreferencesResult> {
  const result = await readJsonFileResult<Partial<PreferencesDto>>(path);
  if (result.status === "missing") {
    return {
      status: "success",
      preferences: createDefaultPreferences("Default"),
    };
  }
  if (result.status !== "success") {
    return result;
  }
  // Merge with defaults so newly added fields are always present.
  const data = result.data;
  const defaults = createDefaultPreferences(data.name ?? "Default");
  const merged = { ...defaults, ...data };
  return {
    status: "success",
    preferences: {
      ...merged,
      timezone: coerceTimezone(data.timezone),
    },
  };
}

// Saves preferences to disk.
export async function savePreferences(
  path: string,
  preferences: PreferencesDto,
): Promise<PreferencesDto> {
  const normalized = {
    ...preferences,
    timezone: normalizeTimezoneOrThrow(preferences.timezone),
  };
  await writeJsonFile(path, normalized);
  return normalized;
}

// Creates a new preferences file with defaults at the given path.
export async function createPreferencesFile(
  path: string,
  name: string,
): Promise<PreferencesDto> {
  const prefs = createDefaultPreferences(name);
  await writeJsonFile(path, prefs);
  return prefs;
}
