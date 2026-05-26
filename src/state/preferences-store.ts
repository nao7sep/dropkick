// PreferencesStore — loaded once at launch from the selected preferences file.
// Provides display settings, timezone, kick distances, etc. to the entire app.

import { create } from "zustand";
import type { PreferencesDto } from "../models";
import { createDefaultPreferences } from "../models";
import type { LoadPreferencesResult } from "../repositories";
import {
  loadPreferences,
  savePreferences,
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
    const { preferences, filePath } = get();
    const updated = { ...preferences, ...changes };
    const saved = await savePreferences(filePath, updated);
    set({ preferences: saved });
  },
}));
