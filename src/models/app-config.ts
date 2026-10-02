// Portable app-level configuration: the document lists the user builds.
export const APP_CONFIG_SET_KEYS = ["knownPreferences", "knownWorkspaces"] as const;
export type AppConfigSetKey = (typeof APP_CONFIG_SET_KEYS)[number];
export interface AppConfigDto {
  knownPreferences: string[];
  knownWorkspaces: string[];
}

export function createDefaultAppConfig(preferencesPath = "", workspacePath = ""): AppConfigDto {
  return {
    knownPreferences: preferencesPath ? [preferencesPath] : [],
    knownWorkspaces: workspacePath ? [workspacePath] : [],
  };
}

// The one check per set, applied where config.json is read
// (config-sets-conventions, Reading and healing).
export function isValidAppConfigSet(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((path) => typeof path === "string");
}

// The map Save writes: every set that differs from its built-in
// (config-sets-conventions).
export function appConfigDocument(appConfig: AppConfigDto, builtIn: AppConfigDto): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const key of APP_CONFIG_SET_KEYS) {
    if (JSON.stringify(appConfig[key]) !== JSON.stringify(builtIn[key])) document[key] = appConfig[key];
  }
  return document;
}

export function registerDocument(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths : [...paths, path];
}

export function unregisterDocument(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((candidate) => candidate !== path) : paths;
}
