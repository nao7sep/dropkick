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
import { mergeWithDefaults } from "../utils/merge-defaults";

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
  // Merge with defaults so newly added fields are always present, and drop any
  // stored keys no longer part of PreferencesDto — a retired field is not copied
  // through the load, so the next flush never re-emits it.
  const data = result.data;
  const defaults = createDefaultPreferences(data.name ?? "Default");
  const merged = mergeWithDefaults(defaults, data);
  const preferences: PreferencesDto = {
    ...merged,
    timezone: coerceTimezone(data.timezone),
    kickDistances: normalizeKickDistances(data.kickDistances),
  };
  // Materialize a missing stable id by persisting it once, so this document's
  // identity does not change between launches — mergeWithDefaults otherwise mints
  // a fresh id on every load until one is written back. Best-effort: a failed
  // write just defers materialization to the next load.
  if (!data.id) {
    try {
      await writeJsonFile(path, preferences);
    } catch {
      // Non-fatal — the id persists on the next successful save.
    }
  }
  return { status: "success", preferences };
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
