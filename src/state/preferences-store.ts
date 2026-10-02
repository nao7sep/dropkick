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
import { message } from "../i18n/translate";
import type { PreferencesDto, PreferenceSetKey } from "../models";
import type { ActionResult } from "./action-result";
import { createDefaultPreferences, PREFERENCE_SET_KEYS } from "../models";
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
  update: (changes: Partial<Pick<PreferencesDto, PreferenceSetKey>>) => Promise<ActionResult>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  // A write resolves after later updates may already have changed the store.
  // The confirmed snapshot provides a safe rollback point after the final
  // outstanding write fails.
  let nextRevision = 0;
  let documentRevision = 0;
  let pendingWrites = 0;
  let lastPersistedWrite = 0;
  let persistedPreferences = createDefaultPreferences("Default");

  return {
    preferences: createDefaultPreferences("Default"),
    filePath: "",
    loaded: false,

    load: async (filePath: string) => {
      const result = await loadPreferences(filePath);
      if (result.status !== "success") return result;

      // A newly loaded document supersedes any completion still in flight from
      // the previous one.
      documentRevision += 1;
      pendingWrites = 0;
      lastPersistedWrite = 0;
      persistedPreferences = result.preferences;
      set({ preferences: result.preferences, filePath, loaded: true });
      return result;
    },

    update: async (changes: Partial<Pick<PreferencesDto, PreferenceSetKey>>) => {
      // The single funnel for every preference change: log which keys changed,
      // not the values, to keep the line stable and free of any future
      // setting's content.
      const changedKeys = PREFERENCE_SET_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(changes, key) && JSON.stringify(changes[key]) !== JSON.stringify(get().preferences[key]));
      if (changedKeys.length === 0) return { status: "success" };
      log.info("preferences updated", { changed: changedKeys });

      const revision = ++nextRevision;

      // Sync state transition first — reads the latest store, applies changes
      // atomically. Concurrent updates queue their own sync transitions and
      // each sees the prior one's result.
      set((state) => ({
        preferences: { ...state.preferences, ...changes },
      }));

      const { filePath } = get();
      if (!filePath) return { status: "success" };
      const writeDocumentRevision = documentRevision;
      pendingWrites += 1;

      // Serialized flush. The getter is invoked inside the slot so it captures
      // the latest state at the moment of the write. A rejected write is
      // reported. Once the final queued attempt fails, the last full snapshot
      // confirmed on disk is restored so an explicit Settings save remains
      // dirty and retryable.
      let written: PreferencesDto | undefined;
      try {
        await flushPreferences(filePath, () => {
          written = get().preferences;
          return written;
        });
      } catch (e) {
        if (documentRevision === writeDocumentRevision) {
          pendingWrites = Math.max(0, pendingWrites - 1);
          if (pendingWrites === 0) {
            set({ preferences: persistedPreferences });
          }
        }
        return {
          status: "error",
          message: message("write.preferences"),
        };
      }

      // A write may capture edits from calls queued behind it, so its complete
      // snapshot—not merely this call's changed keys—is now confirmed on disk.
      // Ignore an out-of-order older completion when selecting the rollback
      // snapshot (the repository serializes these in production; this also
      // makes the store robust to an equivalent adapter).
      if (documentRevision !== writeDocumentRevision) {
        return { status: "success" };
      }
      pendingWrites = Math.max(0, pendingWrites - 1);
      if (written && revision > lastPersistedWrite) {
        persistedPreferences = written;
        lastPersistedWrite = revision;
      }
      return { status: "success" };
    },
  };
});
