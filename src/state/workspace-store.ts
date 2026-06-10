// WorkspaceStore — loaded at launch, written to disk on structural changes.
// Manages open tabs, recent files, and runtime active tab state.
//
// Mutations are split into two phases:
//   1. A synchronous `set((state) => …)` that updates the latest store state.
//   2. An asynchronous flush via the repository, which serializes writes per
//      workspace path. Overlapping flushes never land out of order.

import { create } from "zustand";
import type { WorkspaceDto, RecentFileDto } from "../models";
import { createDefaultWorkspace, createTab, createUnifiedViewTab } from "../models";
import type { LoadWorkspaceResult } from "../repositories";
import { loadWorkspace, flushWorkspace, log } from "../repositories";

// File loading and unloading is owned by the React component tree (MainWindow's
// file-lifecycle effect), so this store deliberately does NOT import or call
// useTaskListStore. Keeping unload off the close-tab path lets unmount-fired
// writes (like a blur on a focused title input) commit to disk before the
// file's hash is forgotten.

interface WorkspaceState {
  // Current workspace data.
  workspace: WorkspaceDto;

  // Path to the loaded workspace file.
  filePath: string;

  // Whether workspace has been loaded.
  loaded: boolean;

  // Actions — each persists to disk after updating state.
  load: (filePath: string) => Promise<LoadWorkspaceResult>;
  addTab: (taskFilePath: string, displayName: string) => Promise<void>;
  addUnifiedViewTab: () => Promise<void>;
  closeTab: (index: number) => Promise<void>;
  setActiveTab: (index: number) => Promise<void>;
  renameTab: (taskFilePath: string, displayName: string) => Promise<void>;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
}

function startupTabIndex(openTabs: WorkspaceDto["openTabs"]): number {
  const unifiedIdx = openTabs.findIndex((t) => t.isUnifiedView);
  if (unifiedIdx !== -1) return unifiedIdx;
  return openTabs.length > 0 ? 0 : -1;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  // Helper: queue a flush for the current workspace path. `getWorkspace` runs
  // inside the serial slot so it sees the latest store state at the moment of
  // the write.
  async function flush(): Promise<void> {
    const { filePath } = get();
    if (!filePath) return;
    await flushWorkspace(filePath, () => get().workspace);
  }

  return {
    workspace: createDefaultWorkspace("Default"),
    filePath: "",
    loaded: false,

    load: async (filePath: string) => {
      const loadResult = await loadWorkspace(filePath);
      if (loadResult.status !== "success") return loadResult;

      // On startup: prefer unified view tab, otherwise first tab. Keep all
      // saved tabs and recent files intact; missing task lists are surfaced
      // when loaded.
      const ws = loadResult.workspace;
      const startIdx = startupTabIndex(ws.openTabs);
      const updated = { ...ws, activeTabIndex: startIdx };

      set({ workspace: updated, filePath, loaded: true });
      return { status: "success", workspace: updated };
    },

    addTab: async (taskFilePath: string, displayName: string) => {
      // Synchronously update state. If the file is already open, just focus it.
      let needsFlush = false;
      set((state) => {
        const alreadyOpen = state.workspace.openTabs.findIndex(
          (t) => !t.isUnifiedView && t.filePath === taskFilePath,
        );
        if (alreadyOpen !== -1) {
          return {
            workspace: { ...state.workspace, activeTabIndex: alreadyOpen },
          };
        }
        const tab = createTab(taskFilePath, displayName);
        const newTabs = [...state.workspace.openTabs, tab];
        needsFlush = true;
        return {
          workspace: {
            ...state.workspace,
            openTabs: newTabs,
            activeTabIndex: newTabs.length - 1,
          },
        };
      });
      if (needsFlush) await flush();
    },

    addUnifiedViewTab: async () => {
      let needsFlush = false;
      set((state) => {
        const alreadyOpen = state.workspace.openTabs.findIndex(
          (t) => t.isUnifiedView,
        );
        if (alreadyOpen !== -1) {
          return {
            workspace: { ...state.workspace, activeTabIndex: alreadyOpen },
          };
        }
        const tab = createUnifiedViewTab();
        const newTabs = [tab, ...state.workspace.openTabs];
        needsFlush = true;
        return {
          workspace: {
            ...state.workspace,
            openTabs: newTabs,
            activeTabIndex: 0,
          },
        };
      });
      if (needsFlush) await flush();
    },

    closeTab: async (index: number) => {
      // Remove the tab from the workspace; file unload is handled by
      // MainWindow's file-lifecycle effect after React commits the unmount.
      set((state) => {
        const newTabs = state.workspace.openTabs.filter((_, i) => i !== index);
        let newActive = state.workspace.activeTabIndex;
        if (index === newActive) {
          newActive = Math.min(newActive, newTabs.length - 1);
        } else if (index < newActive) {
          newActive -= 1;
        }
        return {
          workspace: {
            ...state.workspace,
            openTabs: newTabs,
            activeTabIndex: newActive,
          },
        };
      });
      await flush();
    },

    setActiveTab: async (index: number) => {
      // Runtime-only; not persisted. Tab navigation is frequent, so it stays at
      // debug (developer-only) rather than info. The other tab actions log at
      // info from their TabBar handlers.
      log.debug("set active tab", { index });
      set((state) => {
        if (index === state.workspace.activeTabIndex) return state;
        return { workspace: { ...state.workspace, activeTabIndex: index } };
      });
    },

    renameTab: async (taskFilePath: string, displayName: string) => {
      // Identified by filePath, not index. Indices shift under reorder/close;
      // filePath is stable. Unified view isn't renameable, so no special case.
      set((state) => ({
        workspace: {
          ...state.workspace,
          openTabs: state.workspace.openTabs.map((tab) =>
            !tab.isUnifiedView && tab.filePath === taskFilePath
              ? { ...tab, displayName }
              : tab,
          ),
        },
      }));
      await flush();
    },

    reorderTabs: async (fromIndex: number, toIndex: number) => {
      set((state) => {
        const tabs = [...state.workspace.openTabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);

        let newActive = state.workspace.activeTabIndex;
        if (fromIndex === newActive) {
          newActive = toIndex;
        } else if (fromIndex < newActive && toIndex >= newActive) {
          newActive -= 1;
        } else if (fromIndex > newActive && toIndex <= newActive) {
          newActive += 1;
        }

        return {
          workspace: {
            ...state.workspace,
            openTabs: tabs,
            activeTabIndex: newActive,
          },
        };
      });
      await flush();
    },

    addRecentFile: async (taskFilePath: string) => {
      const now = new Date().toISOString();
      set((state) => {
        const filtered = state.workspace.recentFiles.filter(
          (r) => r.filePath !== taskFilePath,
        );
        const entry: RecentFileDto = {
          filePath: taskFilePath,
          lastOpenedAtUtc: now,
        };
        const recentFiles = [entry, ...filtered].slice(0, 50); // keep at most 50
        return {
          workspace: { ...state.workspace, recentFiles },
        };
      });
      await flush();
    },
  };
});
