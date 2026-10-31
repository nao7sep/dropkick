// SettingsStore — loaded once at launch from the app-wide settings collection.
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
import type { SettingsDto, SettingSets } from "../models";
import type { ActionResult } from "./action-result";
import { changedSettingSets, createDefaultSettings } from "../models";
import type { LoadSettingsResult } from "../repositories";
import {
  initializeSettings,
  flushSettings,
  log,
} from "../repositories";

interface SettingsState {
  // Current settings data.
  settings: SettingsDto;

  // Path to the loaded settings file.
  filePath: string;

  // Whether settings have been loaded.
  loaded: boolean;

  // Actions.
  initialize: () => Promise<LoadSettingsResult & { filePath: string }>;
  update: (changes: Partial<SettingSets>) => Promise<ActionResult>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // One change at a time, the app-config-store form: each change starts from
  // the settings the earlier ones settled, so a failed write restores
  // exactly what was on disk before it and an explicit Settings save stays
  // dirty and retryable.
  let queue: Promise<unknown> = Promise.resolve();

  async function applyChange(changes: Partial<SettingSets>): Promise<ActionResult> {
    const before = get().settings;
    // The single funnel for every preference change: log which keys changed,
    // not the values, to keep the line stable and free of any future
    // setting's content.
    const changed = changedSettingSets(changes, before);
    const changedKeys = Object.keys(changed);
    if (changedKeys.length === 0) return { status: "success" };
    log.info("settings updated", { changed: changedKeys });
    set({ settings: { ...before, ...changed } });

    const { filePath } = get();
    if (!filePath) return { status: "success" };
    try {
      await flushSettings(filePath, () => get().settings);
    } catch {
      set({ settings: before });
      return {
        status: "error",
        message: message("write.settings"),
      };
    }
    return { status: "success" };
  }

  return {
    settings: createDefaultSettings(),
    filePath: "",
    loaded: false,

    initialize: async () => {
      const result = await initializeSettings();
      if (result.status !== "success") return result;
      set({ settings: result.settings, filePath: result.filePath, loaded: true });
      return result;
    },

    update: (changes: Partial<SettingSets>) => {
      const result = queue.then(() => applyChange(changes));
      queue = result.catch(() => undefined);
      return result;
    },
  };
});
