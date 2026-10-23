// Saved workspace locations are config. Browsing never changes the active workspace.
import { create } from "zustand";
import type { AppConfigDto, AppConfigSetKey, StoreRecovery } from "../models";
import { createDefaultAppConfig, registerDocument, unregisterDocument } from "../models";
import { loadAppConfig, flushAppConfig } from "../repositories";
import { guardBackgroundWrite } from "./background-write";

interface AppConfigStore {
  appConfig: AppConfigDto;
  filePath: string;
  loaded: boolean;
  initialize: () => Promise<StoreRecovery | null>;
  // Each resolves true only once the list change is saved.
  register: (path: string) => Promise<boolean>;
  unregister: (path: string) => Promise<boolean>;
}

export const useAppConfigStore = create<AppConfigStore>((set, get) => {
  // Serialize mutation and rollback together: every change starts from the last
  // settled configuration, including when consecutive writes fail.
  let changes: Promise<unknown> = Promise.resolve();
  function changeList(key: AppConfigSetKey, path: string, register: boolean): Promise<boolean> {
    const result = changes.then(() => applyListChange(key, path, register));
    changes = result.catch(() => undefined);
    return result;
  }
  async function applyListChange(key: AppConfigSetKey, path: string, register: boolean): Promise<boolean> {
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
    register: (path) => changeList("knownWorkspaces", path, true),
    unregister: (path) => changeList("knownWorkspaces", path, false),
  };
});
