// WorkspaceStore — loaded at launch, written to disk on structural changes.
// Manages open tabs, recent files, and runtime active tab state.
//
// Mutations are split into two phases:
//   1. A synchronous `set((state) => …)` that updates the latest store state.
//   2. An asynchronous flush via the repository, which serializes writes per
//      workspace path. Overlapping flushes never land out of order.

import { create } from "zustand";
import { message, type Message } from "../i18n/translate";
import type { WorkspaceDto, RecentFileDto } from "../models";
import { createDefaultWorkspace, createTab, createUnifiedViewTab } from "../models";
import { flushWorkspace, drainSerial, log, toErrorFields } from "../repositories";
import { useTaskListStore } from "./task-list-store";
import { commitParkedFields } from "../services/commit-task-fields";
import { useDialogStore } from "./dialog-store";

// Tab loading and unloading is owned by the React component tree (MainWindow's
// file-lifecycle effect). This store settles task-list saves before closing
// their tabs; openWorkspaceSession retires lists across workspace transitions. Keeping unload off the close-tab path lets unmount-fired
// writes (like a blur on a focused title input) commit to disk before the
// file's hash is forgotten.

interface WorkspaceState {
  // Current workspace data.
  workspace: WorkspaceDto;

  // Path to the loaded workspace file.
  filePath: string;

  // Whether workspace has been loaded.
  loaded: boolean;

  // A failed structural write remains visible until dismissed or until a later
  // full workspace write proves the durable state is current again.
  workspacePersistenceError: Message | null;
  dismissWorkspacePersistenceError: () => void;

  // Actions — each persists to disk after updating state.
  adopt: (filePath: string, workspace: WorkspaceDto) => void;
  saveBeforeSwitch: () => Promise<boolean>;
  addTab: (taskFilePath: string, displayName: string) => Promise<void>;
  addUnifiedViewTab: () => Promise<void>;
  closeTab: (index: number) => Promise<void>;
  setActiveTab: (index: number) => Promise<void>;
  renameTab: (taskFilePath: string, displayName: string) => Promise<void>;
  // Renames the open workspace; resolves whether the file now holds the name.
  renameWorkspace: (name: string) => Promise<boolean>;
  reorderTabs: (fromIndex: number, toIndex: number) => Promise<void>;
  addRecentFile: (filePath: string) => Promise<void>;
}

function startupTabIndex(openTabs: WorkspaceDto["openTabs"]): number {
  const unifiedIdx = openTabs.findIndex((t) => t.isUnifiedView);
  if (unifiedIdx !== -1) return unifiedIdx;
  return openTabs.length > 0 ? 0 : -1;
}

// A list whose latest changes are not on disk is asked about before its tab
// closes, as quit asks (unsaved-edits-conventions): Retry saves it again, Close
// Anyway lets the edit go, Cancel keeps the tab. A field that commits on blur
// commits first, and the close waits for the list's writes to settle; local
// storage gets no timeout.
async function mayCloseList(filePath: string): Promise<boolean> {
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  commitParkedFields(filePath);
  for (;;) {
    await drainSerial(filePath);
    if (!useTaskListStore.getState().unsavedFiles[filePath]) return true;
    log.warn("tab close held by changes not saved", { path: filePath });
    const choice = await useDialogStore.getState().enqueueQuitSave([filePath], "tab");
    if (choice === "quit") {
      log.warn("tab closed with changes not saved", { path: filePath });
      return true;
    }
    if (choice === "cancel") return false;
    useTaskListStore.getState().retryUnsaved([filePath]);
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  let structuralVersion = 0;

  // Helper: queue a flush for the current workspace path. `getWorkspace` runs
  // inside the serial slot so it sees the latest store state at the moment of
  // the write.
  async function flush(what: "openTabs" | "tabOrder" = "openTabs"): Promise<boolean> {
    const { filePath } = get();
    if (!filePath) {
      set({ workspacePersistenceError: null });
      return true;
    }
    try {
      await flushWorkspace(filePath, () => get().workspace);
      set({ workspacePersistenceError: null });
      return true;
    } catch (error) {
      log.error("workspace write failed", { what, ...toErrorFields(error) });
      set({
        workspacePersistenceError: message(what === "openTabs" ? "write.openTabs" : "write.tabOrder"),
      });
      return false;
    }
  }

  return {
    workspace: createDefaultWorkspace("Default"),
    filePath: "",
    loaded: false,
    workspacePersistenceError: null,
    dismissWorkspacePersistenceError: () => set({ workspacePersistenceError: null }),

    adopt: (filePath, workspace) => {
      structuralVersion += 1;
      set({ workspace: { ...workspace, activeTabIndex: startupTabIndex(workspace.openTabs) }, filePath, loaded: true, workspacePersistenceError: null });
    },
    saveBeforeSwitch: () => flush(),

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
      if (needsFlush) {
        structuralVersion += 1;
        await flush();
      }
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
      if (needsFlush) {
        structuralVersion += 1;
        await flush();
      }
    },

    closeTab: async (index: number) => {
      const tab = get().workspace.openTabs[index];
      if (tab && !tab.isUnifiedView && !(await mayCloseList(tab.filePath))) return;
      // The tabs may have changed while a question was open.
      const at = tab
        ? get().workspace.openTabs.findIndex(
            (open) => open.isUnifiedView === tab.isUnifiedView && open.filePath === tab.filePath,
          )
        : index;
      if (at < 0) return;
      // Remove the tab from the workspace; file unload is handled by
      // MainWindow's file-lifecycle effect after React commits the unmount.
      set((state) => {
        const newTabs = state.workspace.openTabs.filter((_, i) => i !== at);
        let newActive = state.workspace.activeTabIndex;
        if (at === newActive) {
          newActive = Math.min(newActive, newTabs.length - 1);
        } else if (at < newActive) {
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
      structuralVersion += 1;
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

    renameWorkspace: async (name: string) => {
      set((state) => ({ workspace: { ...state.workspace, name } }));
      return flush();
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
      structuralVersion += 1;
      await flush();
    },

    reorderTabs: async (fromIndex: number, toIndex: number) => {
      const previous = get().workspace;
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

        const optimistic = {
          ...state.workspace,
          openTabs: tabs,
          activeTabIndex: newActive,
        };
        return { workspace: optimistic };
      });
      const reorderVersion = ++structuralVersion;
      if (await flush("tabOrder")) return;

      // Restore only when no later structural action superseded this reorder.
      // Runtime-only tab selection may have changed while the write was in
      // flight, so preserve the selected tab by stable identity.
      if (structuralVersion !== reorderVersion) return;
      structuralVersion += 1;
      set((state) => ({
        workspace: restoreTabOrder(previous, state.workspace),
        workspacePersistenceError: message("write.tabOrderRestored"),
      }));
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
      structuralVersion += 1;
      await flush();
    },
  };
});

function restoreTabOrder(previous: WorkspaceDto, current: WorkspaceDto): WorkspaceDto {
  const active = current.openTabs[current.activeTabIndex];
  const activeIdentity = active ? tabIdentity(active) : null;
  const restoredActiveIndex = activeIdentity === null
    ? previous.activeTabIndex
    : previous.openTabs.findIndex((tab) => tabIdentity(tab) === activeIdentity);
  return {
    ...previous,
    activeTabIndex: restoredActiveIndex >= 0 ? restoredActiveIndex : previous.activeTabIndex,
  };
}

function tabIdentity(tab: WorkspaceDto["openTabs"][number]): string {
  return tab.isUnifiedView ? "__unified__" : tab.filePath;
}
