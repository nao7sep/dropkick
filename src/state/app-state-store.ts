// AppStateStore — loaded once at launch from ~/.dropkick/state.json.
// Tracks known preferences/workspace paths and the last selection.
//
// Mutations are synchronous `set((state) => …)` over the latest store state,
// followed by an `await flush()` that serializes the disk write per path.
// Concurrent register / unregister calls all read and apply against the
// latest state, and disk writes can never land out of order — same pattern
// as task-list, workspace, and preferences stores.

import { create } from "zustand";
import { guardBackgroundWrite } from "./background-write";
import type { AppStateDto } from "../models";
import { createDefaultAppState } from "../models";
import { initializeAppState, flushAppState, log } from "../repositories";

// The view-state fields callers may set through updateViewState. Restricting the
// patch to these keeps the register/unregister list logic the sole writer of the
// path fields — a generic setter would let a caller stomp knownPreferences.
type ViewStateChanges = Partial<Pick<AppStateDto, "zoomLevel" | "sidebarWidth">>;

interface AppStateStore {
  // The current app-level state.
  appState: AppStateDto;

  // Path to ~/.dropkick/state.json.
  filePath: string;

  // Whether the state has been loaded from disk.
  loaded: boolean;

  // Actions.
  initialize: () => Promise<string | null>;
  // Apply a live view adjustment (zoom / sidebar width) and persist it. The single
  // funnel for zoom shortcuts, the hamburger-menu zoom, and the divider drag — the
  // state-store analogue of the preferences store's `update`.
  updateViewState: (changes: ViewStateChanges) => Promise<void>;
  setLastPaths: (
    preferencesPath: string,
    workspacePath: string,
  ) => Promise<void>;
  registerPreferences: (path: string) => Promise<void>;
  registerWorkspace: (path: string) => Promise<void>;
  unregisterPreferences: (path: string) => Promise<void>;
  unregisterWorkspace: (path: string) => Promise<void>;
}

export const useAppStateStore = create<AppStateStore>((set, get) => {
  async function flush(): Promise<void> {
    const { filePath } = get();
    if (!filePath) return;
    // View state persists as a side effect of ordinary interaction (a zoom
    // shortcut, a divider drag), so a failure is reported rather than thrown —
    // see guardBackgroundWrite.
    await guardBackgroundWrite("Your window layout", () =>
      flushAppState(filePath, () => get().appState),
    );
  }

  return {
    appState: createDefaultAppState(),
    filePath: "",
    loaded: false,

    initialize: async () => {
      const { appState, statePath, quarantinedTo } = await initializeAppState();
      set({ appState, filePath: statePath, loaded: true });
      return quarantinedTo;
    },

    updateViewState: async (changes) => {
      // Log which keys changed, not the values, to keep the line stable — same
      // funnel discipline as the preferences store's update.
      log.info("view state updated", { changed: Object.keys(changes) });
      set((state) => ({ appState: { ...state.appState, ...changes } }));
      await flush();
    },

    setLastPaths: async (preferencesPath, workspacePath) => {
      set((state) => ({
        appState: {
          ...state.appState,
          lastPreferencesPath: preferencesPath,
          lastWorkspacePath: workspacePath,
        },
      }));
      await flush();
    },

    registerPreferences: async (path) => {
      set((state) => {
        const known = state.appState.knownPreferences.includes(path)
          ? state.appState.knownPreferences
          : [...state.appState.knownPreferences, path];
        return {
          appState: {
            ...state.appState,
            knownPreferences: known,
            lastPreferencesPath: path,
          },
        };
      });
      await flush();
    },

    registerWorkspace: async (path) => {
      set((state) => {
        const known = state.appState.knownWorkspaces.includes(path)
          ? state.appState.knownWorkspaces
          : [...state.appState.knownWorkspaces, path];
        return {
          appState: {
            ...state.appState,
            knownWorkspaces: known,
            lastWorkspacePath: path,
          },
        };
      });
      await flush();
    },

    unregisterPreferences: async (path) => {
      set((state) => {
        const known = state.appState.knownPreferences.filter((p) => p !== path);
        const lastPreferencesPath =
          state.appState.lastPreferencesPath === path
            ? (known[0] ?? "")
            : state.appState.lastPreferencesPath;
        return {
          appState: {
            ...state.appState,
            knownPreferences: known,
            lastPreferencesPath,
          },
        };
      });
      await flush();
    },

    unregisterWorkspace: async (path) => {
      set((state) => {
        const known = state.appState.knownWorkspaces.filter((p) => p !== path);
        const lastWorkspacePath =
          state.appState.lastWorkspacePath === path
            ? (known[0] ?? "")
            : state.appState.lastWorkspacePath;
        return {
          appState: {
            ...state.appState,
            knownWorkspaces: known,
            lastWorkspacePath,
          },
        };
      });
      await flush();
    },
  };
});
