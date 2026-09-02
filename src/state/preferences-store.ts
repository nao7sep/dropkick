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

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  // A write resolves after later updates may already have changed the store.
  // Track the latest update per field so an older completion can normalize
  // only the fields whose values it actually captured, never overwrite a
  // newer edit. The confirmed snapshot provides a safe rollback point after
  // the final outstanding write fails.
  const fieldRevisions = new Map<keyof PreferencesDto, number>();
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
      fieldRevisions.clear();
      pendingWrites = 0;
      lastPersistedWrite = 0;
      persistedPreferences = result.preferences;
      set({ preferences: result.preferences, filePath, loaded: true });
      return result;
    },

    update: async (changes: Partial<PreferencesDto>) => {
      // The single funnel for every preference change (a Settings save, the
      // theme shortcut): log which keys changed, not the values, to keep the
      // line stable and free of any future setting's content.
      const changedKeys = Object.keys(changes) as (keyof PreferencesDto)[];
      log.info("preferences updated", { changed: changedKeys });

      const revision = ++nextRevision;
      for (const key of changedKeys) fieldRevisions.set(key, revision);

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
      let normalized: PreferencesDto;
      const writeCapture: {
        revisions?: Map<keyof PreferencesDto, number>;
      } = {};
      try {
        normalized = await flushPreferences(filePath, () => {
          writeCapture.revisions = new Map(fieldRevisions);
          return get().preferences;
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
          message: "Preferences could not be saved. Your previous settings are still in use; try again.",
        };
      }

      // A write may capture edits from calls queued behind it, so its complete
      // result—not merely this call's changed keys—is now confirmed on disk.
      // Ignore an out-of-order older completion when selecting the rollback
      // snapshot (the repository serializes these in production; this also
      // makes the store robust to an equivalent adapter).
      if (documentRevision !== writeDocumentRevision) {
        return { status: "success" };
      }
      pendingWrites = Math.max(0, pendingWrites - 1);
      if (revision > lastPersistedWrite) {
        persistedPreferences = normalized;
        lastPersistedWrite = revision;
      }

      // Absorb normalization only for fields whose revisions were captured by
      // this write. Replacing the whole object would erase a later update that
      // landed after the repository invoked its getter.
      const capturedRevisions = writeCapture.revisions;
      if (!capturedRevisions) return { status: "success" };
      set((state) => {
        let preferences = state.preferences;
        for (const key of Object.keys(normalized) as (keyof PreferencesDto)[]) {
          if (fieldRevisions.get(key) !== capturedRevisions.get(key)) continue;
          if (Object.is(preferences[key], normalized[key])) continue;
          preferences = { ...preferences, [key]: normalized[key] };
        }
        return preferences === state.preferences ? state : { preferences };
      });
      return { status: "success" };
    },
  };
});
