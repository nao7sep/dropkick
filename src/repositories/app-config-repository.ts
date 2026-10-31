// Sparse app-level config sets (config-sets-conventions).
import type { AppConfigDto, FileRefusal } from "../models";
import { appConfigDocument, APP_CONFIG_SET_KEYS, createDefaultAppConfig, isValidAppConfigSet } from "../models";
import { appPaths, readJsonFileResult, writeJsonFile, withSerial } from "./file-system";
import { keepUnreadSets } from "./kept-sets";
import { log } from "./logging";

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// config.json as stored, or why it was refused. Reading writes nothing.
async function readMap(
  filePath: string,
): Promise<{ map: Record<string, unknown> } | { refusal: FileRefusal }> {
  const result = await readJsonFileResult<unknown>(filePath, "config");
  if (result.status === "missing") return { map: {} };
  if (result.status === "success" && isMap(result.data)) return { map: result.data };
  const reason = result.status === "newer" ? "newer" : "unreadable";
  log.warn("config.json refused; left in place", {
    filePath,
    reason,
    ...(result.status === "invalid" || result.status === "error" ? { error: { message: result.message } } : {}),
  });
  return { refusal: { path: filePath, reason } };
}

// The saved workspace list is a list the user built, so a refused config.json
// stops the launch (`refusal`); the session then has no file to write.
export async function loadAppConfig(): Promise<{
  appConfig: AppConfigDto;
  filePath: string;
  refusal: FileRefusal | null;
}> {
  const { configFile } = await appPaths();
  const read = await readMap(configFile);
  const appConfig = createDefaultAppConfig();
  if ("refusal" in read) return { appConfig, filePath: "", refusal: read.refusal };
  for (const key of APP_CONFIG_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(read.map, key)) continue;
    const value = read.map[key];
    if (!isValidAppConfigSet(value)) {
      log.warn("app config set is invalid; using built-in and keeping the stored value", { filePath: configFile, key });
      continue;
    }
    appConfig[key] = value;
  }
  return { appConfig, filePath: configFile, refusal: null };
}

// Each save reads the file again, so one that has since become unreadable or
// newer is refused rather than replaced, and what this build did not read is
// kept.
export async function flushAppConfig(filePath: string, getAppConfig: () => AppConfigDto): Promise<void> {
  await withSerial(filePath, async () => {
    const read = await readMap(filePath);
    if ("refusal" in read) throw new Error("Cannot save unavailable app config");
    const builtIn = createDefaultAppConfig();
    const appConfig = getAppConfig();
    const document = keepUnreadSets(
      appConfigDocument(appConfig, builtIn), read.map, APP_CONFIG_SET_KEYS,
      appConfig, builtIn, (_key, value) => isValidAppConfigSet(value),
    );
    await writeJsonFile(filePath, "config", document);
  });
}
