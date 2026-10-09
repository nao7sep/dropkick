// Sparse app-level config sets (config-sets-conventions).
import type { AppConfigDto, StoreRecovery } from "../models";
import { appConfigDocument, APP_CONFIG_SET_KEYS, createDefaultAppConfig, isV010Document, isValidAppConfigSet } from "../models";
import { appPaths, readJsonFileResult, quarantineFile, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMap(
  filePath: string,
): Promise<{ map: Record<string, unknown> | null; recovery: StoreRecovery | null }> {
  const result = await readJsonFileResult<unknown>(filePath, "config");
  if (result.status === "missing") return { map: null, recovery: null };
  if (result.status === "error") throw new Error(`Failed to load app config: ${result.message}`);
  if (result.status === "newer") {
    log.warn("config.json is newer than this build; left in place and not written this session", {
      filePath,
      formatVersion: result.formatVersion,
    });
    return { map: {}, recovery: { kind: "newer", formatVersion: result.formatVersion } };
  }
  if (result.status === "success" && isMap(result.data)) return { map: result.data, recovery: null };
  const quarantinedTo = await quarantineFile(filePath, "config");
  log.warn("corrupt config.json quarantined; using built-ins", { filePath, quarantinedTo });
  return { map: {}, recovery: { kind: "quarantined", quarantinedTo } };
}

async function builtInAppConfig(): Promise<AppConfigDto> {
  const { preferencesFile, workspaceFile } = await appPaths();
  return createDefaultAppConfig(preferencesFile, workspaceFile);
}

// v0.1.0 kept the saved locations in state.json, which has no config.json
// beside it (developer decision: the next version opens v0.1.0's files).
async function v010Locations(stateFile: string): Promise<Record<string, unknown> | null> {
  const result = await readJsonFileResult<unknown>(stateFile, "state");
  if (result.status !== "success" || !isV010Document(result.data)) return null;
  const data = result.data;
  return Object.fromEntries(APP_CONFIG_SET_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(data, key))
    .map((key) => [key, data[key]]));
}

// `filePath` is empty when config.json was written by a newer build, so the
// session keeps its list changes in memory and writes nothing over that file.
export async function loadAppConfig() {
  const { configFile, stateFile } = await appPaths();
  const read = await readMap(configFile);
  const { recovery } = read;
  const carried = read.map === null ? await v010Locations(stateFile) : null;
  const map = read.map ?? carried ?? {};
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
  // Written at once, unlike any other load: the next view-state save rewrites
  // state.json in this build's format, which would otherwise drop them.
  if (carried) await flushAppConfig(configFile, () => appConfig);
  return { appConfig, filePath, recovery };
}

export async function flushAppConfig(filePath: string, getAppConfig: () => AppConfigDto): Promise<void> {
  const builtIn = await builtInAppConfig();
  await withSerial(filePath, () => writeJsonFile(filePath, "config", appConfigDocument(getAppConfig(), builtIn)));
}
