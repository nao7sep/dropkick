// WorkspaceStore — loaded at launch, written to disk on every structural change.
// Manages open tabs, recent files, and active tab index.

import { create } from "zustand";
import type { WorkspaceDto, RecentFileDto } from "../models";
import { createDefaultWorkspace, createTab, createUnifiedViewTab } from "../models";
import { loadWorkspace, saveWorkspace } from "../repositories";

interface WorkspaceState {
  // Current workspace data.
  workspace: WorkspaceDto;

  // Path to the loaded workspace file.
  filePath: string;

  // Whether workspace has been loaded.
  loaded: boolean;

  // Actions — each persists to disk after updating state.
  load: (filePath: string) => Promise<void>;
  addTab: (taskFilePath: string, displayName: string) => Promise<void>;
  addUnifiedViewTab: () => Promise<void>;
  closeTab: (index: number) => Promise<void>;
  setActiveTab: (index: number) => Promise<void>;
  renameTab: (index: number, displayName: string) => Promise<void>;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
}

// Helper: persists workspace to disk.
async function persist(filePath: string, workspace: WorkspaceDto) {
  await saveWorkspace(filePath, workspace);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: createDefaultWorkspace("Default"),
  filePath: "",
  loaded: false,

  load: async (filePath: string) => {
    const ws = await loadWorkspace(filePath);

    // On startup: prefer unified view tab, otherwise first tab.
    const unifiedIdx = ws.openTabs.findIndex((t) => t.isUnifiedView);
    const startIdx =
      unifiedIdx !== -1
        ? unifiedIdx
        : ws.openTabs.length > 0
          ? 0
          : -1;
    const updated = { ...ws, activeTabIndex: startIdx };

    set({ workspace: updated, filePath, loaded: true });
    await persist(filePath, updated);
  },

  addTab: async (taskFilePath: string, displayName: string) => {
    const { workspace, filePath } = get();

    // Don't open the same file twice.
    const alreadyOpen = workspace.openTabs.findIndex(
      (t) => !t.isUnifiedView && t.filePath === taskFilePath,
    );
    if (alreadyOpen !== -1) {
      // Just switch to the existing tab.
      const updated = { ...workspace, activeTabIndex: alreadyOpen };
      set({ workspace: updated });
      await persist(filePath, updated);
      return;
    }

    const tab = createTab(taskFilePath, displayName);
    const newTabs = [...workspace.openTabs, tab];
    const updated = {
      ...workspace,
      openTabs: newTabs,
      activeTabIndex: newTabs.length - 1,
    };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  addUnifiedViewTab: async () => {
    const { workspace, filePath } = get();

    // Don't open unified view twice.
    const alreadyOpen = workspace.openTabs.findIndex((t) => t.isUnifiedView);
    if (alreadyOpen !== -1) {
      const updated = { ...workspace, activeTabIndex: alreadyOpen };
      set({ workspace: updated });
      await persist(filePath, updated);
      return;
    }

    const tab = createUnifiedViewTab();
    const newTabs = [tab, ...workspace.openTabs];
    const updated = {
      ...workspace,
      openTabs: newTabs,
      activeTabIndex: 0,
    };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  closeTab: async (index: number) => {
    const { workspace, filePath } = get();
    const newTabs = workspace.openTabs.filter((_, i) => i !== index);

    // Adjust active tab index.
    let newActive = workspace.activeTabIndex;
    if (index === newActive) {
      // Closed the active tab — go to the previous one, or -1 if none.
      newActive = Math.min(newActive, newTabs.length - 1);
    } else if (index < newActive) {
      // Closed a tab before the active one — shift index down.
      newActive -= 1;
    }

    const updated = {
      ...workspace,
      openTabs: newTabs,
      activeTabIndex: newActive,
    };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  setActiveTab: async (index: number) => {
    const { workspace, filePath } = get();
    if (index === workspace.activeTabIndex) return;

    const updated = { ...workspace, activeTabIndex: index };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  renameTab: async (index: number, displayName: string) => {
    const { workspace, filePath } = get();
    const newTabs = workspace.openTabs.map((tab, i) =>
      i === index ? { ...tab, displayName } : tab,
    );
    const updated = { ...workspace, openTabs: newTabs };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  reorderTabs: async (fromIndex: number, toIndex: number) => {
    const { workspace, filePath } = get();
    const tabs = [...workspace.openTabs];
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);

    // Adjust active tab index to follow the previously active tab.
    let newActive = workspace.activeTabIndex;
    if (fromIndex === newActive) {
      newActive = toIndex;
    } else {
      if (fromIndex < newActive && toIndex >= newActive) {
        newActive -= 1;
      } else if (fromIndex > newActive && toIndex <= newActive) {
        newActive += 1;
      }
    }

    const updated = {
      ...workspace,
      openTabs: tabs,
      activeTabIndex: newActive,
    };
    set({ workspace: updated });
    await persist(filePath, updated);
  },

  addRecentFile: async (filePath: string) => {
    const { workspace, filePath: wsPath } = get();
    const now = new Date().toISOString();

    // Remove existing entry for this path (if any) and add to front.
    const filtered = workspace.recentFiles.filter(
      (r) => r.filePath !== filePath,
    );
    const entry: RecentFileDto = { filePath, lastOpenedAtUtc: now };
    const recentFiles = [entry, ...filtered].slice(0, 50); // keep at most 50

    const updated = { ...workspace, recentFiles };
    set({ workspace: updated });
    await persist(wsPath, updated);
  },
}));
