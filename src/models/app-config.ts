// App-level configuration stored at ~/.dropkick/app.json
// Remembers known workspace/preferences files and last selections.

export interface AppConfigDto {
  version: string;
  lastPreferencesPath: string;
  lastWorkspacePath: string;
  knownPreferences: string[]; // absolute paths
  knownWorkspaces: string[]; // absolute paths
}

export function createDefaultAppConfig(): AppConfigDto {
  return {
    version: "1.0.0",
    lastPreferencesPath: "",
    lastWorkspacePath: "",
    knownPreferences: [],
    knownWorkspaces: [],
  };
}
