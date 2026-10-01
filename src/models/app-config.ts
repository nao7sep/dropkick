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

export function registerDocument(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths : [...paths, path];
}

export function unregisterDocument(paths: string[], path: string): string[] {
  return paths.includes(path) ? paths.filter((candidate) => candidate !== path) : paths;
}
