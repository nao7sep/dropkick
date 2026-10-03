// Disposable view state and last selections; document lists belong to config.

import { create } from "zustand";
import { guardBackgroundWrite, type BackgroundWrite } from "./background-write";
import type { AppStateDto } from "../models";
import { createDefaultAppState } from "../models";
import { initializeAppState, flushAppState, log } from "../repositories";

type ViewStateChanges = Partial<Pick<AppStateDto, "zoomLevel" | "sidebarWidth" | "recordsListWidth">>;

interface AppStateStore {
  // The current app-level state.
  appState: AppStateDto;

  // Path to ~/.dropkick/state.json.
  filePath: string;

  // Whether the state has been loaded from disk.
  loaded: boolean;

  // Actions.
  initialize: () => Promise<void>;
  // Apply a live view adjustment (zoom / sidebar width / Records list width) and
  // persist it. The single funnel for zoom shortcuts, the hamburger-menu zoom,
  // and the divider drags — the state-store analogue of the preferences store's
  // `update`.
  updateViewState: (changes: ViewStateChanges) => Promise<void>;
  setLastPaths: (
    preferencesPath: string,
    workspacePath: string,
  ) => Promise<void>;
  selectPreferences: (path: string) => Promise<void>;
  selectWorkspace: (path: string) => Promise<void>;
  forgetPreferences: (path: string, nextPath: string) => Promise<void>;
  forgetWorkspace: (path: string, nextPath: string) => Promise<void>;
}

export const useAppStateStore = create<AppStateStore>((set, get) => {
  async function flush(what: BackgroundWrite): Promise<void> {
    const { filePath } = get();
    if (!filePath) return;
    // App state persists as a side effect of ordinary interaction (a zoom,
    // divider drag, or saved-location choice), so a failure is reported rather
    // than thrown — see guardBackgroundWrite. `what` keeps the result specific.
    await guardBackgroundWrite(what, () =>
      flushAppState(filePath, () => get().appState),
    );
  }

  return {
    appState: createDefaultAppState(),
    filePath: "",
    loaded: false,

    initialize: async () => {
      const { appState, statePath } = await initializeAppState();
      set({ appState, filePath: statePath, loaded: true });
    },

    updateViewState: async (changes) => {
      // Log which keys changed, not the values, to keep the line stable — same
      // funnel discipline as the preferences store's update.
      log.info("view state updated", { changed: Object.keys(changes) });
      set((state) => ({ appState: { ...state.appState, ...changes } }));
      await flush("viewSettings");
    },

    setLastPaths: async (preferencesPath, workspacePath) => {
      set((state) => ({
        appState: {
          ...state.appState,
          lastPreferencesPath: preferencesPath,
          lastLaunchedPreferencesPath: preferencesPath,
          lastWorkspacePath: workspacePath,
        },
      }));
      await flush("savedLocations");
    },

    selectPreferences: async (path) => {
      set((state) => ({ appState: { ...state.appState, lastPreferencesPath: path } }));
      await flush("savedLocations");
    },
    selectWorkspace: async (path) => {
      set((state) => ({ appState: { ...state.appState, lastWorkspacePath: path } }));
      await flush("savedLocations");
    },
    forgetPreferences: async (path, nextPath) => {
      set((state) => ({ appState: {
        ...state.appState,
        lastPreferencesPath: state.appState.lastPreferencesPath === path ? nextPath : state.appState.lastPreferencesPath,
        lastLaunchedPreferencesPath: state.appState.lastLaunchedPreferencesPath === path ? "" : state.appState.lastLaunchedPreferencesPath,
      } }));
      await flush("savedLocations");
    },
    forgetWorkspace: async (path, nextPath) => {
      set((state) => ({ appState: {
        ...state.appState,
        lastWorkspacePath: state.appState.lastWorkspacePath === path ? nextPath : state.appState.lastWorkspacePath,
      } }));
      await flush("savedLocations");
    },
  };
});
