// Owns the single app-wide settings collection.
import type { SettingsDto } from "../models";
import {
  createDefaultSettings,
  isValidSettingSet, SETTING_SET_KEYS, settingsDocument,
} from "../models";
import { appPaths, readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { keepUnreadSets } from "./kept-sets";
import { log } from "./logging";

export type LoadSettingsResult =
  | { status: "success"; settings: SettingsDto }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string };

function effectiveSettings(data: Record<string, unknown>, path: string): SettingsDto {
  const settings = createDefaultSettings();
  for (const key of SETTING_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (!isValidSettingSet(key, value)) {
      log.warn("settings set is invalid; using built-in and keeping the stored value", { path, key });
      continue;
    }
    Object.assign(settings, { [key]: value });
  }
  return settings;
}

function isSettings(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    && Object.keys(data).every((key) => key === "format" || key === "writer" || SETTING_SET_KEYS.some((known) => key === known));
}

export async function initializeSettings(): Promise<LoadSettingsResult & { filePath: string }> {
  const { settingsFile } = await appPaths();
  const result = await readJsonFileResult<unknown>(settingsFile, "settings");
  if (result.status === "success") {
    return isSettings(result.data)
      ? { status: "success", settings: effectiveSettings(result.data, settingsFile), filePath: settingsFile }
      : { status: "invalid", message: "unrecognized app settings", filePath: settingsFile };
  }
  if (result.status === "missing") {
    return { status: "success", settings: createDefaultSettings(), filePath: settingsFile };
  }
  return { ...result, filePath: settingsFile };
}

// Each save reads the file again, so one that has since become unreadable or
// newer is refused rather than replaced, and a stored set this build could not
// use is kept until the user changes it.
export async function flushSettings(path: string, getSettings: () => SettingsDto): Promise<void> {
  return withSerial(path, async () => {
    const result = await readJsonFileResult<unknown>(path, "settings");
    if (result.status !== "missing" && (result.status !== "success" || !isSettings(result.data))) {
      throw new Error("Cannot save unavailable app settings");
    }
    const settings = getSettings();
    const stored = result.status === "success" ? result.data as Record<string, unknown> : {};
    const document = keepUnreadSets(
      settingsDocument(settings), stored, SETTING_SET_KEYS,
      settings, createDefaultSettings(), isValidSettingSet,
    );
    await writeJsonFile(path, "settings", document);
  });
}
