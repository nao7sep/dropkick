// The known-document lists have one config owner; selection belongs to state.
import { create } from "zustand";
import type { AppConfigDto, AppConfigSetKey } from "../models";
import { createDefaultAppConfig } from "../models";
import { registerDocument, unregisterDocument } from "../models/app-config";
import { loadAppConfig, flushAppConfig } from "../repositories";
import { guardBackgroundWrite } from "./background-write";

interface AppConfigStore {
  appConfig: AppConfigDto;
  filePath: string;
  loaded: boolean;
  initialize: () => Promise<string | null>;
  registerPreferences: (path: string) => Promise<void>;
  registerWorkspace: (path: string) => Promise<void>;
  unregisterPreferences: (path: string) => Promise<void>;
  unregisterWorkspace: (path: string) => Promise<void>;
}

export const useAppConfigStore = create<AppConfigStore>((set, get) => {
  let persisted = createDefaultAppConfig();
  async function changeList(key: AppConfigSetKey, path: string, register: boolean) {
    const current = get().appConfig[key];
    const next = register ? registerDocument(current, path) : unregisterDocument(current, path);
    if (next === current) return;
    set((state) => ({ appConfig: { ...state.appConfig, [key]: next } }));
    const { filePath } = get();
    if (filePath) await guardBackgroundWrite("savedLocations", async () => {
      let written = next;
      try {
        await flushAppConfig(filePath, () => {
          written = get().appConfig[key];
          return get().appConfig;
        }, [key]);
        persisted = { ...persisted, [key]: written };
      } catch (error) {
        if (get().appConfig[key] === next) {
          set((state) => ({ appConfig: { ...state.appConfig, [key]: persisted[key] } }));
        }
        throw error;
      }
    });
  }
  return {
    appConfig: createDefaultAppConfig(), filePath: "", loaded: false,
    initialize: async () => {
      const { appConfig, filePath, quarantinedTo } = await loadAppConfig();
      persisted = appConfig;
      set({ appConfig, filePath, loaded: true });
      return quarantinedTo;
    },
    registerPreferences: (path) => changeList("knownPreferences", path, true),
    registerWorkspace: (path) => changeList("knownWorkspaces", path, true),
    unregisterPreferences: (path) => changeList("knownPreferences", path, false),
    unregisterWorkspace: (path) => changeList("knownWorkspaces", path, false),
  };
});
