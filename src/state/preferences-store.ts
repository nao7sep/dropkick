// PreferencesStore — loaded once at launch from the selected preferences file.
// Provides display settings, timezone, kick distances, etc. to the entire app.
//
// `update` mutates synchronously, then awaits a serialized flush via the
// repository. Concurrent updates (e.g. divider drag completing during a
// Settings Save click) all read and apply against the latest store state, and
// disk writes can never land out of order.

import { create } from "zustand";
import type { PreferencesDto } from "../models";
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
  update: (changes: Partial<PreferencesDto>) => Promise<void>;
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
    // The single funnel for every preference change (Settings save, zoom,
    // dark-mode toggle, sidebar drag): log which keys changed, not the values,
    // to keep the line stable and free of any future setting's content.
    log.info("preferences updated", { changed: Object.keys(changes) });

    // Sync state transition first — reads the latest store, applies changes
    // atomically. Concurrent updates queue their own sync transitions and
    // each sees the prior one's result.
    set((state) => ({
      preferences: { ...state.preferences, ...changes },
    }));

    const { filePath } = get();
    if (!filePath) return;

    // Serialized flush. The getter is invoked inside the slot so it captures
    // the latest state at the moment of the write.
    const normalized = await flushPreferences(filePath, () => get().preferences);

    // Absorb any normalization the repository applied (e.g. timezone
    // coercion). Idempotent if nothing was normalized.
    set({ preferences: normalized });
  },
}));
