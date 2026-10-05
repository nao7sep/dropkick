// Sparse app-level config sets (config-sets-conventions).
import type { AppConfigDto, StoreRecovery } from "../models";
import { appConfigDocument, APP_CONFIG_SET_KEYS, createDefaultAppConfig, isValidAppConfigSet } from "../models";
import { appPaths, readJsonFileResult, quarantineFile, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMap(filePath: string): Promise<{ map: Record<string, unknown>; recovery: StoreRecovery | null }> {
  const result = await readJsonFileResult<unknown>(filePath, "config");
  if (result.status === "missing") return { map: {}, recovery: null };
  if (result.status === "error") throw new Error(`Failed to load app config: ${result.message}`);
  if (result.status === "newer") {
    log.warn("config.json is newer than this build; left in place and not written this session", {
      filePath,
      formatVersion: result.formatVersion,
    });
    return { map: {}, recovery: { kind: "newer", formatVersion: result.formatVersion } };
  }
  if (result.status === "success" && isMap(result.data)) return { map: result.data, recovery: null };
  const quarantinedTo = await quarantineFile(filePath);
  log.warn("corrupt config.json quarantined; using built-ins", { filePath, quarantinedTo });
  return { map: {}, recovery: { kind: "quarantined", quarantinedTo } };
}

async function builtInAppConfig(): Promise<AppConfigDto> {
  const { preferencesFile, workspaceFile } = await appPaths();
  return createDefaultAppConfig(preferencesFile, workspaceFile);
}

// `filePath` is empty when config.json was written by a newer build, so the
// session keeps its list changes in memory and writes nothing over that file.
export async function loadAppConfig() {
  const { configFile } = await appPaths();
  const { map, recovery } = await readMap(configFile);
  const appConfig = await builtInAppConfig();
  for (const key of APP_CONFIG_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
    const value = map[key];
    if (!isValidAppConfigSet(value)) {
      log.warn("app config set is invalid; using built-in", { filePath: configFile, key });
      continue;
    }
    appConfig[key] = value;
  }
  const filePath = recovery?.kind === "newer" ? "" : configFile;
  return { appConfig, filePath, recovery };
}

export async function flushAppConfig(filePath: string, getAppConfig: () => AppConfigDto): Promise<void> {
  const builtIn = await builtInAppConfig();
  await withSerial(filePath, () => writeJsonFile(filePath, "config", appConfigDocument(getAppConfig(), builtIn)));
}
