// Manages ~/.dropkick/app.json — the app-level configuration.
// Handles first-launch setup and remembering workspace/preferences paths.

import { homeDir } from "@tauri-apps/api/path";
import type { AppConfigDto } from "../models";
import {
  createDefaultAppConfig,
  createDefaultPreferences,
  createDefaultWorkspace,
} from "../models";
import { readJsonFile, writeJsonFile, ensureDirectory, fileExists } from "./file-system";

const DROPKICK_DIR = ".dropkick";
const APP_CONFIG_FILE = "app.json";
const DEFAULT_PREFERENCES_FILE = "default-preferences.json";
const DEFAULT_WORKSPACE_FILE = "default-workspace.json";

// Returns the full path to ~/.dropkick/
async function getDropkickDir(): Promise<string> {
  const home = await homeDir();
  return `${home}${DROPKICK_DIR}`;
}

// Returns the full path to ~/.dropkick/app.json
async function getAppConfigPath(): Promise<string> {
  const dir = await getDropkickDir();
  return `${dir}/${APP_CONFIG_FILE}`;
}

// First-launch setup: creates ~/.dropkick/ with default config, preferences, and workspace.
// Returns the app config. If everything already exists, just reads and returns it.
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

  // Create default preferences if missing.
  if (!(await fileExists(prefsPath))) {
    const prefs = createDefaultPreferences("Default");
    await writeJsonFile(prefsPath, prefs);
  }

  // Create default workspace if missing.
  if (!(await fileExists(workspacePath))) {
    const workspace = createDefaultWorkspace("Default");
    await writeJsonFile(workspacePath, workspace);
  }

  // Create or read app config.
  let config = await readJsonFile<AppConfigDto>(configPath);
  if (config === null) {
    config = createDefaultAppConfig();
    config.lastPreferencesPath = prefsPath;
    config.lastWorkspacePath = workspacePath;
    config.knownPreferences = [prefsPath];
    config.knownWorkspaces = [workspacePath];
    await writeJsonFile(configPath, config);
  }

  return { config, configPath };
}

// Saves the app config to disk.
export async function saveAppConfig(config: AppConfigDto): Promise<void> {
  const configPath = await getAppConfigPath();
  await writeJsonFile(configPath, config);
}

// Adds a preferences path to the known list (if not already there) and saves.
export async function registerPreferencesPath(
  config: AppConfigDto,
  path: string,
): Promise<AppConfigDto> {
  if (!config.knownPreferences.includes(path)) {
    config = {
      ...config,
      knownPreferences: [...config.knownPreferences, path],
    };
  }
  config = { ...config, lastPreferencesPath: path };
  await saveAppConfig(config);
  return config;
}

// Adds a workspace path to the known list (if not already there) and saves.
export async function registerWorkspacePath(
  config: AppConfigDto,
  path: string,
): Promise<AppConfigDto> {
  if (!config.knownWorkspaces.includes(path)) {
    config = {
      ...config,
      knownWorkspaces: [...config.knownWorkspaces, path],
    };
  }
  config = { ...config, lastWorkspacePath: path };
  await saveAppConfig(config);
  return config;
}

// Removes a preferences path from the known list and saves.
export async function unregisterPreferencesPath(
  config: AppConfigDto,
  path: string,
): Promise<AppConfigDto> {
  config = {
    ...config,
    knownPreferences: config.knownPreferences.filter((p) => p !== path),
  };
  if (config.lastPreferencesPath === path) {
    config = {
      ...config,
      lastPreferencesPath: config.knownPreferences[0] ?? "",
    };
  }
  await saveAppConfig(config);
  return config;
}

// Removes a workspace path from the known list and saves.
export async function unregisterWorkspacePath(
  config: AppConfigDto,
  path: string,
): Promise<AppConfigDto> {
  config = {
    ...config,
    knownWorkspaces: config.knownWorkspaces.filter((p) => p !== path),
  };
  if (config.lastWorkspacePath === path) {
    config = {
      ...config,
      lastWorkspacePath: config.knownWorkspaces[0] ?? "",
    };
  }
  await saveAppConfig(config);
  return config;
}
