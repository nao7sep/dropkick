// Reads and writes preferences files.

import type { PreferencesDto } from "../models";
import { createDefaultPreferences } from "../models";
import { readJsonFile, writeJsonFile } from "./file-system";
import { coerceTimezone, normalizeTimezoneOrThrow } from "../utils/timezone";

// Loads a preferences file. Returns default preferences if the file is missing or invalid.
export async function loadPreferences(path: string): Promise<PreferencesDto> {
  const data = await readJsonFile<Partial<PreferencesDto>>(path);
  if (data === null) {
    return createDefaultPreferences("Default");
  }
  // Merge with defaults so newly added fields are always present.
  const defaults = createDefaultPreferences(data.name ?? "Default");
  const merged = { ...defaults, ...data };
  return {
    ...merged,
    timezone: coerceTimezone(data.timezone),
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
