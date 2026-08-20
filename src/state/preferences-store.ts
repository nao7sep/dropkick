// PreferencesStore — loaded once at launch from the selected preferences file.
// Provides display settings, timezone, kick distances, etc. to the entire app.
//
// `update` mutates synchronously, then awaits a serialized flush via the
// repository. Concurrent updates all read and apply against the latest store
// state, and disk writes can never land out of order.
//
// Zoom and sidebar width are NOT here: they are view state and live in
// state.json through the app-state store (persisted-store-separation-
// conventions), so nothing they do can reach this file.

import { create } from "zustand";
import type { PreferencesDto } from "../models";
import type { ActionResult } from "./action-result";
import { createDefaultPreferences } from "../models";
import type { LoadPreferencesResult } from "../repositories";
import {
  loadPreferences,
  flushPreferences,
  log,
} from "../repositories";

interface PreferencesState {
  // Current preferences data.
  preferences: PreferencesDto;

  // Path to the loaded preferences file.
  filePath: string;

  // Whether preferences have been loaded.
  loaded: boolean;

  // Actions.
  load: (filePath: string) => Promise<LoadPreferencesResult>;
  update: (changes: Partial<PreferencesDto>) => Promise<ActionResult>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: createDefaultPreferences("Default"),
  filePath: "",
  loaded: false,

  load: async (filePath: string) => {
    const result = await loadPreferences(filePath);
    if (result.status !== "success") return result;

    set({ preferences: result.preferences, filePath, loaded: true });
    return result;
  },

  update: async (changes: Partial<PreferencesDto>) => {
    // The single funnel for every preference change (a Settings save, the
    // dark-mode toggle): log which keys changed, not the values, to keep the
    // line stable and free of any future setting's content.
    log.info("preferences updated", { changed: Object.keys(changes) });

    // Sync state transition first — reads the latest store, applies changes
    // atomically. Concurrent updates queue their own sync transitions and
    // each sees the prior one's result.
    set((state) => ({
      preferences: { ...state.preferences, ...changes },
    }));

    const { filePath } = get();
    if (!filePath) return { status: "success" };

    // Serialized flush. The getter is invoked inside the slot so it captures
    // the latest state at the moment of the write. A rejected write is reported
    // rather than thrown, the same never-reject contract the task-list store's
    // actions have: the state transition above has already applied the change
    // in memory, so an escaping rejection would leave the UI showing settings
    // that never reached disk — and would strand the Settings modal open with
    // no message, because its Save handler never reaches onClose(). The write
    // boundary has already logged the cause.
    let normalized: PreferencesDto;
    try {
      normalized = await flushPreferences(filePath, () => get().preferences);
    } catch (e) {
      return {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }

    // Absorb any normalization the repository applied (e.g. timezone
    // coercion). Idempotent if nothing was normalized.
    set({ preferences: normalized });
    return { status: "success" };
  },
}));
