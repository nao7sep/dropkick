// Portable preferences documents hold their identity and only changed sets
// (config-sets-conventions).

import type { PreferencesDto } from "../models";
import {
  createDefaultPreferences, fromV010Preferences, isPreferencesDocument, isV010Document,
  isV010PreferencesCandidate,
  isValidPreferenceSet, PREFERENCE_SET_KEYS, preferencesDocument,
} from "../models";
import { readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

export type LoadPreferencesResult =
  | { status: "success"; preferences: PreferencesDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

function effectivePreferences(
  data: Record<string, unknown> & { id: string; name: string },
  path: string,
): PreferencesDto {
  const preferences = createDefaultPreferences(data.name);
  preferences.id = data.id;
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

// A read document as this build's: v0.1.0's converted, any other as it is.
function current(data: unknown): unknown {
  return isV010Document(data) && isV010PreferencesCandidate(data) ? fromV010Preferences(data) : data;
}

export async function loadPreferences(path: string): Promise<LoadPreferencesResult> {
  const result = await readJsonFileResult<unknown>(path, "preferences");
  if (result.status !== "success") return result;
  const data = current(result.data);
  if (!isPreferencesDocument(data)) {
    return { status: "invalid", message: "not a preferences document" };
  }
  return { status: "success", preferences: effectivePreferences(data, path) };
}

export async function flushPreferences(
  path: string,
  getPreferences: () => PreferencesDto,
): Promise<void> {
  return withSerial(path, async () => {
    // A newer build's document is refused like any other unavailable one.
    const result = await readJsonFileResult<unknown>(path, "preferences");
    if (result.status !== "missing"
      && (result.status !== "success" || !isPreferencesDocument(current(result.data)))) {
      throw new Error("Cannot save an unavailable preferences document");
    }
    await writeJsonFile(path, "preferences", preferencesDocument(getPreferences()));
  });
}

export async function createPreferencesFile(path: string, name: string): Promise<PreferencesDto> {
  const preferences = createDefaultPreferences(name);
  await writeJsonFile(path, "preferences", preferencesDocument(preferences));
  return preferences;
}
