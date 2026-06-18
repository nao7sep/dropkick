// Manages ~/.dropkick/app.json — the app-level configuration.
//
// initializeAppConfig handles first-launch setup (creating ~/.dropkick/ and
// default preferences/workspace files). It runs exactly once at startup, so
// it doesn't need serialization. All subsequent writes go through
// flushAppConfig, which uses withSerial — the same pattern as the other
// repositories. The actual data manipulation (register/unregister) lives in
// useAppConfigStore; this module owns I/O only.

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
  appDataRoot,
  joinPath,
  withSerial,
} from "./file-system";
import { mergeWithDefaults } from "../utils/merge-defaults";
import { log } from "./logging";

const APP_CONFIG_FILE = "app.json";
const DEFAULT_PREFERENCES_FILE = "default-preferences.json";
const DEFAULT_WORKSPACE_FILE = "default-workspace.json";

// Returns the app's absolute storage root (~/.dropkick, or DROPKICK_HOME).
// The Rust core resolves and creates it; the webview never reconstructs it.
async function getDropkickDir(): Promise<string> {
  return await appDataRoot();
}

// Returns the full path to <root>/app.json
async function getAppConfigPath(): Promise<string> {
  const dir = await getDropkickDir();
  return joinPath(dir, APP_CONFIG_FILE);
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
  const prefsPath = joinPath(dir, DEFAULT_PREFERENCES_FILE);
  const workspacePath = joinPath(dir, DEFAULT_WORKSPACE_FILE);

  // Ensure ~/.dropkick/ exists.
  await ensureDirectory(dir);

  // Create or read app config.
  const configResult = await readJsonFileResult<AppConfigDto>(configPath);
  let config: AppConfigDto;
  const created = configResult.status === "missing";
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
    // Fill any newly added fields from defaults and drop keys no longer part of
    // AppConfigDto, so a retired field is never re-emitted — the same
    // load-boundary contract as the preferences and workspace repositories.
    config = mergeWithDefaults(createDefaultAppConfig(), configResult.data);
  } else {
    throw new Error(`Failed to load app config: ${configResult.message}`);
  }

  log.info("app config initialized", { configPath, created });
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
