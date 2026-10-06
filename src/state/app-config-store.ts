// The known-document lists have one config owner; selection belongs to state.
// A list change and the selection that follows it are made together here, the
// selection only once the list change is saved.
import { create } from "zustand";
import type { AppConfigDto, AppConfigSetKey, StoreRecovery } from "../models";
import { createDefaultAppConfig, registerDocument, unregisterDocument } from "../models";
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
  initialize: () => Promise<StoreRecovery | null>;
  // Each resolves true once the list change is saved and the selection has
  // followed it; false leaves the selection as it was.
  registerAndSelect: (kind: KnownDocumentKind, path: string) => Promise<boolean>;
  unregisterAndReselect: (kind: KnownDocumentKind, path: string) => Promise<boolean>;
}

export const useAppConfigStore = create<AppConfigStore>((set, get) => {
  async function changeList(key: AppConfigSetKey, path: string, register: boolean): Promise<boolean> {
    const current = get().appConfig[key];
    const next = register ? registerDocument(current, path) : unregisterDocument(current, path);
    if (next === current) return true;
    set((state) => ({ appConfig: { ...state.appConfig, [key]: next } }));
    const { filePath } = get();
    if (!filePath) return true;
    let saved = false;
    await guardBackgroundWrite("savedLocations", async () => {
      await flushAppConfig(filePath, () => get().appConfig);
      saved = true;
    });
    // A list change that did not reach the disk is undone, unless a later
    // change has replaced it, so retrying it writes again rather than finding
    // nothing to do.
    if (!saved) {
      set((state) =>
        state.appConfig[key] === next ? { appConfig: { ...state.appConfig, [key]: current } } : state,
      );
    }
    return saved;
  }
  return {
    appConfig: createDefaultAppConfig(), filePath: "", loaded: false,
    initialize: async () => {
      const { appConfig, filePath, recovery } = await loadAppConfig();
      set({ appConfig, filePath, loaded: true });
      return recovery;
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
