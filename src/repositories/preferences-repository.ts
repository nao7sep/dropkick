// Portable preferences documents hold their identity and only changed sets
// (config-sets-conventions).

import type { PreferencesDto } from "../models";
import {
  createDefaultPreferences, isPreferencesDocument, isValidPreferenceSet,
  PREFERENCE_SET_KEYS, preferencesDocument,
} from "../models";
import { readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

export type LoadPreferencesResult =
  | { status: "success"; preferences: PreferencesDto }
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

function effectivePreferences(data: Record<string, unknown> & { id: string }, path: string): PreferencesDto {
  const preferences = createDefaultPreferences(typeof data.name === "string" ? data.name : "Default");
  preferences.id = data.id;
  for (const key of PREFERENCE_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    // A null time zone is how earlier documents stored the system zone.
    if (key === "timezone" && value === null) continue;
    if (!isValidPreferenceSet(key, value)) {
      log.warn("preferences set is invalid; using built-in", { path, key });
      continue;
    }
    Object.assign(preferences, { [key]: value });
  }
  return preferences;
}

export async function loadPreferences(path: string): Promise<LoadPreferencesResult> {
  const result = await readJsonFileResult<unknown>(path);
  if (result.status !== "success") return result;
  if (!isPreferencesDocument(result.data)) {
    return { status: "invalid", message: "not a preferences document" };
  }
  return { status: "success", preferences: effectivePreferences(result.data, path) };
}

export async function flushPreferences(
  path: string,
  getPreferences: () => PreferencesDto,
): Promise<void> {
  return withSerial(path, async () => {
    const result = await readJsonFileResult<unknown>(path);
    if (result.status !== "success" || !isPreferencesDocument(result.data)) {
      throw new Error("Cannot save an unavailable preferences document");
    }
    await writeJsonFile(path, preferencesDocument(getPreferences()));
  });
}

export async function createPreferencesFile(path: string, name: string): Promise<PreferencesDto> {
  const preferences = createDefaultPreferences(name);
  await writeJsonFile(path, preferencesDocument(preferences));
  return preferences;
}
