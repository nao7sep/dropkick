// Reads and writes preferences files.
//
// Saves are serialized per path. The store mutates synchronously and then
// awaits a flush; if several flushes queue against the same path, each runs in
// order and writes the latest store state at the moment its turn comes up.
// Matches the pattern used by task-list and workspace stores.

import type { PreferencesDto } from "../models";
import {
  createDefaultPreferences,
  normalizeKickDistances,
} from "../models";
import { readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { coerceTimezone, normalizeTimezoneOrThrow } from "../utils/timezone";

export type LoadPreferencesResult =
  | { status: "success"; preferences: PreferencesDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

// Loads a preferences file. Missing and invalid files are reported explicitly so
// selected files do not silently become default settings.
export async function loadPreferences(
  path: string,
): Promise<LoadPreferencesResult> {
  const result = await readJsonFileResult<Partial<PreferencesDto>>(path);
  if (result.status === "missing") {
    return { status: "missing" };
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
      kickDistances: normalizeKickDistances(data.kickDistances),
    },
  };
}

// Flushes the latest preferences state to disk. Calls are serialized per
// path, so overlapping flushes can never land out of order. `getPreferences`
// is invoked inside the serial slot so it sees the latest store state at the
// instant of the write. Returns the normalized preferences so the store can
// re-apply timezone coercion to its in-memory copy.
export async function flushPreferences(
  path: string,
  getPreferences: () => PreferencesDto,
): Promise<PreferencesDto> {
  return withSerial(path, async () => {
    const preferences = getPreferences();
    const normalized = {
      ...preferences,
      timezone: normalizeTimezoneOrThrow(preferences.timezone),
      kickDistances: normalizeKickDistances(preferences.kickDistances),
    };
    await writeJsonFile(path, normalized);
    return normalized;
  });
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
