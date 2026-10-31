// Disposable view state and last selections; document lists belong to config.

import { create } from "zustand";
import { guardBackgroundWrite, type BackgroundWrite } from "./background-write";
import type { AppStateDto } from "../models";
import { createDefaultAppState } from "../models";
import { initializeAppState, flushAppState, log } from "../repositories";

type ViewStateChanges = Partial<Pick<AppStateDto, "zoomLevel" | "sidebarWidth" | "recordsListWidth">>;

// A stepped adjustment, such as a divider moved by the arrow keys, saves this
// long after its last step; each step pushes the save back.
export const VIEW_STEP_SAVE_DELAY_MS = 500;

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
  // and the divider adjustments — the state-store analogue of the settings store's
  // `update`.
  updateViewState: (changes: ViewStateChanges) => Promise<void>;
  // Apply one step of a continuous adjustment at once and save it
  // VIEW_STEP_SAVE_DELAY_MS after the last step.
  stepViewState: (changes: ViewStateChanges) => void;
  // Start a step save still waiting for its delay now (window close).
  flushViewSteps: () => void;
  setLastWorkspace: (workspacePath: string) => Promise<void>;
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

  let stepSave: ReturnType<typeof setTimeout> | null = null;
  const cancelStepSave = (): void => {
    if (stepSave !== null) clearTimeout(stepSave);
    stepSave = null;
  };

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
      // funnel discipline as the settings store's update.
      log.info("view state updated", { changed: Object.keys(changes) });
      set((state) => ({ appState: { ...state.appState, ...changes } }));
      // This write carries any step still waiting for its delay.
      cancelStepSave();
      await flush("viewSettings");
    },

    stepViewState: (changes) => {
      set((state) => ({ appState: { ...state.appState, ...changes } }));
      cancelStepSave();
      stepSave = setTimeout(() => {
        stepSave = null;
        log.info("view state updated", { changed: Object.keys(changes) });
        void flush("viewSettings");
      }, VIEW_STEP_SAVE_DELAY_MS);
    },

    flushViewSteps: () => {
      if (stepSave === null) return;
      cancelStepSave();
      void flush("viewSettings");
    },

    setLastWorkspace: async (workspacePath) => {
      set((state) => ({
        appState: {
          ...state.appState,
          lastWorkspacePath: workspacePath,
        },
      }));
      await flush("savedLocations");
    },

  };
});
