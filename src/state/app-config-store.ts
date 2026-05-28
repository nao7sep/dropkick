// AppConfigStore — loaded once at launch from ~/.dropkick/app.json.
// Tracks known preferences/workspace paths and the last selection.
//
// Mutations are synchronous `set((state) => …)` over the latest store state,
// followed by an `await flush()` that serializes the disk write per path.
// Concurrent register / unregister calls all read and apply against the
// latest state, and disk writes can never land out of order — same pattern
// as task-list, workspace, and preferences stores.

import { create } from "zustand";
import type { AppConfigDto } from "../models";
import { createDefaultAppConfig } from "../models";
import { initializeAppConfig, flushAppConfig } from "../repositories";

interface AppConfigState {
  // Current config data.
  config: AppConfigDto;

  // Path to ~/.dropkick/app.json.
  filePath: string;

  // Whether the config has been initialized from disk.
  loaded: boolean;

  // Actions.
  initialize: () => Promise<void>;
  setLastPaths: (
    preferencesPath: string,
    workspacePath: string,
  ) => Promise<void>;
  registerPreferences: (path: string) => Promise<void>;
  registerWorkspace: (path: string) => Promise<void>;
  unregisterPreferences: (path: string) => Promise<void>;
  unregisterWorkspace: (path: string) => Promise<void>;
}

export const useAppConfigStore = create<AppConfigState>((set, get) => {
  async function flush(): Promise<void> {
    const { filePath } = get();
    if (!filePath) return;
    await flushAppConfig(filePath, () => get().config);
  }

  return {
    config: createDefaultAppConfig(),
    filePath: "",
    loaded: false,

    initialize: async () => {
      const { config, configPath } = await initializeAppConfig();
      set({ config, filePath: configPath, loaded: true });
    },

    setLastPaths: async (preferencesPath, workspacePath) => {
      set((state) => ({
        config: {
          ...state.config,
          lastPreferencesPath: preferencesPath,
          lastWorkspacePath: workspacePath,
        },
      }));
      await flush();
    },

    registerPreferences: async (path) => {
      set((state) => {
        const known = state.config.knownPreferences.includes(path)
          ? state.config.knownPreferences
          : [...state.config.knownPreferences, path];
        return {
          config: {
            ...state.config,
            knownPreferences: known,
            lastPreferencesPath: path,
          },
        };
      });
      await flush();
    },

    registerWorkspace: async (path) => {
      set((state) => {
        const known = state.config.knownWorkspaces.includes(path)
          ? state.config.knownWorkspaces
          : [...state.config.knownWorkspaces, path];
        return {
          config: {
            ...state.config,
            knownWorkspaces: known,
            lastWorkspacePath: path,
          },
        };
      });
      await flush();
    },

    unregisterPreferences: async (path) => {
      set((state) => {
        const known = state.config.knownPreferences.filter((p) => p !== path);
        const lastPreferencesPath =
          state.config.lastPreferencesPath === path
            ? (known[0] ?? "")
            : state.config.lastPreferencesPath;
        return {
          config: {
            ...state.config,
            knownPreferences: known,
            lastPreferencesPath,
          },
        };
      });
      await flush();
    },

    unregisterWorkspace: async (path) => {
      set((state) => {
        const known = state.config.knownWorkspaces.filter((p) => p !== path);
        const lastWorkspacePath =
          state.config.lastWorkspacePath === path
            ? (known[0] ?? "")
            : state.config.lastWorkspacePath;
        return {
          config: {
            ...state.config,
            knownWorkspaces: known,
            lastWorkspacePath,
          },
        };
      });
      await flush();
    },
  };
});
