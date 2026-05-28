// Manages ~/.dropkick/app.json — the app-level configuration.
//
// initializeAppConfig handles first-launch setup (creating ~/.dropkick/ and
// default preferences/workspace files). It runs exactly once at startup, so
// it doesn't need serialization. All subsequent writes go through
// flushAppConfig, which uses withSerial — the same pattern as the other
// repositories. The actual data manipulation (register/unregister) lives in
// useAppConfigStore; this module owns I/O only.

import { homeDir } from "@tauri-apps/api/path";
import type { AppConfigDto } from "../models";
import {
  createDefaultAppConfig,
  createDefaultPreferences,
  createDefaultWorkspace,
} from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  ensureDirectory,
  fileExists,
  withSerial,
} from "./file-system";

const DROPKICK_DIR = ".dropkick";
const APP_CONFIG_FILE = "app.json";
const DEFAULT_PREFERENCES_FILE = "default-preferences.json";
const DEFAULT_WORKSPACE_FILE = "default-workspace.json";

// Returns the full path to ~/.dropkick/
async function getDropkickDir(): Promise<string> {
  const home = await homeDir();
  // homeDir() may or may not include a trailing slash depending on platform.
  const separator = home.endsWith("/") || home.endsWith("\\") ? "" : "/";
  return `${home}${separator}${DROPKICK_DIR}`;
}

// Returns the full path to ~/.dropkick/app.json
async function getAppConfigPath(): Promise<string> {
  const dir = await getDropkickDir();
  return `${dir}/${APP_CONFIG_FILE}`;
}

// First-launch setup: creates ~/.dropkick/ with default config, preferences, and workspace.
// Returns the app config. Once app config exists, selected files are never
// recreated implicitly; missing selections are reported by their loaders.
export async function initializeAppConfig(): Promise<{
  config: AppConfigDto;
  configPath: string;
}> {
  const dir = await getDropkickDir();
  const configPath = await getAppConfigPath();
  const prefsPath = `${dir}/${DEFAULT_PREFERENCES_FILE}`;
  const workspacePath = `${dir}/${DEFAULT_WORKSPACE_FILE}`;

  // Ensure ~/.dropkick/ exists.
  await ensureDirectory(dir);

  // Create or read app config.
  const configResult = await readJsonFileResult<AppConfigDto>(configPath);
  let config: AppConfigDto;
  if (configResult.status === "missing") {
    // Create default preferences if missing.
    if (!(await fileExists(prefsPath))) {
      const prefs = createDefaultPreferences("Default");
      await writeJsonFile(prefsPath, prefs);
    }

    // Create default workspace if missing.
    if (!(await fileExists(workspacePath))) {
      const workspace = createDefaultWorkspace("Default");
      const { activeTabIndex: _activeTabIndex, ...persisted } = workspace;
      await writeJsonFile(workspacePath, persisted);
    }

    config = createDefaultAppConfig();
    config.lastPreferencesPath = prefsPath;
    config.lastWorkspacePath = workspacePath;
    config.knownPreferences = [prefsPath];
    config.knownWorkspaces = [workspacePath];
    await writeJsonFile(configPath, config);
  } else if (configResult.status === "success") {
    config = configResult.data;
  } else {
    throw new Error(`Failed to load app config: ${configResult.message}`);
  }

  return { config, configPath };
}

// Flushes the latest app config state to disk. Calls are serialized per path,
// so overlapping flushes can never land out of order. `getConfig` is invoked
// inside the serial slot so it sees the latest store state at the instant of
// the write.
export async function flushAppConfig(
  filePath: string,
  getConfig: () => AppConfigDto,
): Promise<void> {
  await withSerial(filePath, async () => {
    await writeJsonFile(filePath, getConfig());
  });
}
