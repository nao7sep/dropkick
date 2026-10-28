// PreferencesStore — loaded once at launch from the app-wide settings collection.
// Provides display settings, timezone, kick distances, etc. to the entire app.
//
// `update` takes its turn in the store's change chain: it applies the change,
// then awaits its flush via the repository, before the next change starts.
//
// Zoom and sidebar width are NOT here: they are view state and live in
// state.json through the app-state store (persisted-store-separation-
// conventions), so nothing they do can reach this file.

import { create } from "zustand";
import { message } from "../i18n/translate";
import type { PreferencesDto, PreferenceSets } from "../models";
import type { ActionResult } from "./action-result";
import { changedPreferenceSets, createDefaultPreferences } from "../models";
import type { LoadPreferencesResult } from "../repositories";
import {
  initializePreferences,
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
  initialize: () => Promise<LoadPreferencesResult & { filePath: string }>;
  update: (changes: Partial<PreferenceSets>) => Promise<ActionResult>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  // One change at a time, the app-config-store form: each change starts from
  // the preferences the earlier ones settled, so a failed write restores
  // exactly what was on disk before it and an explicit Settings save stays
  // dirty and retryable.
  let queue: Promise<unknown> = Promise.resolve();

  async function applyChange(changes: Partial<PreferenceSets>): Promise<ActionResult> {
    const before = get().preferences;
    // The single funnel for every preference change: log which keys changed,
    // not the values, to keep the line stable and free of any future
    // setting's content.
    const changed = changedPreferenceSets(changes, before);
    const changedKeys = Object.keys(changed);
    if (changedKeys.length === 0) return { status: "success" };
    log.info("preferences updated", { changed: changedKeys });
    set({ preferences: { ...before, ...changed } });

    const { filePath } = get();
    if (!filePath) return { status: "success" };
    try {
      await flushPreferences(filePath, () => get().preferences);
    } catch {
      set({ preferences: before });
      return {
        status: "error",
        message: message("write.preferences"),
      };
    }
    return { status: "success" };
  }

  return {
    preferences: createDefaultPreferences(),
    filePath: "",
    loaded: false,

    initialize: async () => {
      const result = await initializePreferences();
      if (result.status !== "success") return result;
      set({ preferences: result.preferences, filePath: result.filePath, loaded: true });
      return result;
    },

    update: (changes: Partial<PreferenceSets>) => {
      const result = queue.then(() => applyChange(changes));
      queue = result.catch(() => undefined);
      return result;
    },
  };
});
