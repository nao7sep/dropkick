// PreferencesStore — loaded once at launch from the selected preferences file.
// Provides display settings, timezone, kick distances, etc. to the entire app.

import { create } from "zustand";
import type { PreferencesDto } from "../models";
import { createDefaultPreferences } from "../models";
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
  load: (filePath: string) => Promise<void>;
  update: (changes: Partial<PreferencesDto>) => Promise<void>;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: createDefaultPreferences("Default"),
  filePath: "",
  loaded: false,

  load: async (filePath: string) => {
    const prefs = await loadPreferences(filePath);
    set({ preferences: prefs, filePath, loaded: true });
  },

  update: async (changes: Partial<PreferencesDto>) => {
    const { preferences, filePath } = get();
    const updated = { ...preferences, ...changes };
    const saved = await savePreferences(filePath, updated);
    set({ preferences: saved });
  },
}));
