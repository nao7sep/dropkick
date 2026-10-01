// Sparse app-level config sets. Reads never seed or reconcile a set's members.
import type { AppConfigDto, AppConfigSetKey } from "../models";
import { APP_CONFIG_SET_KEYS, createDefaultAppConfig } from "../models";
import { appPaths, readJsonFileResult, quarantineFile, writeJsonFile, withSerial } from "./file-system";
import { log } from "./logging";

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readMap(filePath: string): Promise<{ map: Record<string, unknown>; quarantinedTo: string | null }> {
  const result = await readJsonFileResult<unknown>(filePath);
  if (result.status === "missing") return { map: {}, quarantinedTo: null };
  if (result.status === "error") throw new Error(`Failed to load app config: ${result.message}`);
  if (result.status === "success" && isMap(result.data)) return { map: result.data, quarantinedTo: null };
  const quarantinedTo = await quarantineFile(filePath);
  log.warn("corrupt config.json quarantined; using built-ins", { filePath, quarantinedTo });
  return { map: {}, quarantinedTo };
}

export async function loadAppConfig() {
  const { configFile: filePath, preferencesFile, workspaceFile } = await appPaths();
  const { map, quarantinedTo } = await readMap(filePath);
  const appConfig = createDefaultAppConfig(preferencesFile, workspaceFile);
  for (const key of APP_CONFIG_SET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
    const value = map[key];
    if (!Array.isArray(value) || !value.every((path) => typeof path === "string")) {
      log.warn("app config set has wrong shape; using built-in", { filePath, key });
      continue;
    }
    appConfig[key] = value;
  }
  return { appConfig, filePath, quarantinedTo };
}

export async function flushAppConfig(
  filePath: string,
  getAppConfig: () => AppConfigDto,
  changedKeys: readonly AppConfigSetKey[],
): Promise<void> {
  await withSerial(filePath, async () => {
    const { map } = await readMap(filePath);
    const stored: Record<string, unknown> = {};
    for (const key of APP_CONFIG_SET_KEYS) {
      if (Object.prototype.hasOwnProperty.call(map, key)) stored[key] = map[key];
    }
    const config = getAppConfig();
    for (const key of changedKeys) stored[key] = config[key];
    await writeJsonFile(filePath, stored);
  });
}
