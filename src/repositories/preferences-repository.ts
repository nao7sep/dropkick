// Portable preferences documents hold their identity and only changed sets.
// One serialized patch path re-reads the current map before replacing those sets.

import type { PreferencesDto, PreferenceSetKey } from "../models";
import {
  createDefaultPreferences, isPreferencesDocument, PREFERENCE_SET_KEYS,
  normalizeDueSoonDays, normalizeHandledTasksPageSize, normalizeKickDistances,
} from "../models";
import { readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { coerceTimezone, normalizeTimezoneOrThrow } from "../utils/timezone";
import { isLanguage } from "../i18n/languages";
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
    const valid = key === "language" ? value === "system" || isLanguage(value)
      : key === "theme" ? value === "system" || value === "light" || value === "dark"
      : key === "fontFamily" ? typeof value === "string"
      : key === "timezone" ? value === null || typeof value === "string"
      : key === "kickDistances" ? Array.isArray(value) && value.every((n) => typeof n === "number" && Number.isFinite(n))
      : key === "confirmPermanentDeletions" ? typeof value === "boolean"
      : typeof value === "number" && Number.isFinite(value);
    if (!valid) {
      log.warn("preferences set has wrong shape; using built-in", { path, key });
      continue;
    }
    Object.assign(preferences, { [key]: value });
  }
  // Existing value-use normalization remains separate from set shape.
  preferences.timezone = coerceTimezone(preferences.timezone);
  preferences.kickDistances = normalizeKickDistances(preferences.kickDistances);
  preferences.dueSoonDays = normalizeDueSoonDays(preferences.dueSoonDays);
  preferences.handledTasksPageSize = normalizeHandledTasksPageSize(preferences.handledTasksPageSize);
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
  changedKeys: readonly PreferenceSetKey[],
): Promise<PreferencesDto> {
  return withSerial(path, async () => {
    const result = await readJsonFileResult<unknown>(path);
    if (result.status !== "success" || !isPreferencesDocument(result.data)) {
      throw new Error("Cannot save an unavailable preferences document");
    }
    const current = result.data;
    const stored: Record<string, unknown> & { id: string } = { id: current.id, name: current.name };
    for (const key of PREFERENCE_SET_KEYS) {
      if (Object.prototype.hasOwnProperty.call(current, key)) stored[key] = current[key];
    }
    const preferences = getPreferences();
    for (const key of changedKeys) {
      stored[key] = key === "timezone" ? normalizeTimezoneOrThrow(preferences.timezone)
        : key === "kickDistances" ? normalizeKickDistances(preferences.kickDistances)
        : key === "dueSoonDays" ? normalizeDueSoonDays(preferences.dueSoonDays)
        : key === "handledTasksPageSize" ? normalizeHandledTasksPageSize(preferences.handledTasksPageSize)
        : preferences[key];
    }
    await writeJsonFile(path, stored);
    return effectivePreferences(stored, path);
  });
}

export async function createPreferencesFile(path: string, name: string): Promise<PreferencesDto> {
  const preferences = createDefaultPreferences(name);
  await writeJsonFile(path, { id: preferences.id, name });
  return preferences;
}
