// App-level state stored at ~/.dropkick/state.json
// Remembers known workspace/preferences files and last selections — all
// rebuildable, so this is state rather than durable configuration.

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
