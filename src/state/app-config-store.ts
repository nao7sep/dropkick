// The known-document lists have one config owner; selection belongs to state.
// A list change and the selection that follows it are made together here, the
// selection only once the list change is saved.
import { create } from "zustand";
import type { AppConfigDto, AppConfigSetKey } from "../models";
import { createDefaultAppConfig } from "../models";
import { registerDocument, unregisterDocument } from "../models/app-config";
import { loadAppConfig, flushAppConfig } from "../repositories";
import { useAppStateStore } from "./app-state-store";
import { guardBackgroundWrite } from "./background-write";

export type KnownDocumentKind = "preferences" | "workspace";

const LIST_KEY: Readonly<Record<KnownDocumentKind, AppConfigSetKey>> = {
  preferences: "knownPreferences",
  workspace: "knownWorkspaces",
};

interface AppConfigStore {
  appConfig: AppConfigDto;
  filePath: string;
  loaded: boolean;
  initialize: () => Promise<string | null>;
  // Each resolves true once the list change is saved and the selection has
  // followed it; false leaves both as they were.
  registerAndSelect: (kind: KnownDocumentKind, path: string) => Promise<boolean>;
  unregisterAndReselect: (kind: KnownDocumentKind, path: string) => Promise<boolean>;
}

export const useAppConfigStore = create<AppConfigStore>((set, get) => {
  let persisted = createDefaultAppConfig();
  async function changeList(key: AppConfigSetKey, path: string, register: boolean): Promise<boolean> {
    const current = get().appConfig[key];
    const next = register ? registerDocument(current, path) : unregisterDocument(current, path);
    if (next === current) return true;
    set((state) => ({ appConfig: { ...state.appConfig, [key]: next } }));
    const { filePath } = get();
    if (!filePath) return true;
    let saved = false;
    await guardBackgroundWrite("savedLocations", async () => {
      let written = get().appConfig;
      try {
        await flushAppConfig(filePath, () => {
          written = get().appConfig;
          return written;
        });
        persisted = written;
        saved = true;
      } catch (error) {
        if (get().appConfig[key] === next) {
          set((state) => ({ appConfig: { ...state.appConfig, [key]: persisted[key] } }));
        }
        throw error;
      }
    });
    return saved;
  }
  return {
    appConfig: createDefaultAppConfig(), filePath: "", loaded: false,
    initialize: async () => {
      const { appConfig, filePath, quarantinedTo } = await loadAppConfig();
      persisted = appConfig;
      set({ appConfig, filePath, loaded: true });
      return quarantinedTo;
    },
    registerAndSelect: async (kind, path) => {
      if (!(await changeList(LIST_KEY[kind], path, true))) return false;
      const appState = useAppStateStore.getState();
      await (kind === "preferences" ? appState.selectPreferences(path) : appState.selectWorkspace(path));
      return true;
    },
    unregisterAndReselect: async (kind, path) => {
      const key = LIST_KEY[kind];
      if (!(await changeList(key, path, false))) return false;
      const nextPath = get().appConfig[key][0] ?? "";
      const appState = useAppStateStore.getState();
      await (kind === "preferences"
        ? appState.forgetPreferences(path, nextPath)
        : appState.forgetWorkspace(path, nextPath));
      return true;
    },
  };
});
