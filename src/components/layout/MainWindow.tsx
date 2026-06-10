// Main window — tab bar + two-panel layout (task list | task detail).

import { useEffect, useState, useRef, useCallback, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showMessage, drainAllSerial } from "../../repositories";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import {
  pickNextActiveKey,
  taskSelectionKey,
  toTask,
  isZoomIn,
  isZoomOut,
  isZoomReset,
  stepZoomIn,
  stepZoomOut,
  ZOOM_DEFAULT,
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
} from "../../utils";
import {
  groupTasksForList,
  groupTasksForUnifiedView,
} from "../../services";
import { TabBar } from "./TabBar";
import { SettingsModal } from "./SettingsModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { AboutModal } from "./AboutModal";
import { NewTaskModal } from "./NewTaskModal";
import { MoveTasksModal } from "./MoveTasksModal";
import { TaskListPane } from "../task-list/TaskListPane";
import { TaskDetailPane } from "../task-detail/TaskDetailPane";
import type { Task } from "../../models";

// Error boundary — catches rendering errors and shows them instead of blank screen.
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md rounded-lg bg-danger-surface p-6">
            <h3 className="mb-2 font-bold text-danger">Rendering Error</h3>
            <p className="text-sm text-danger">{this.state.error}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MainWindow() {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updatePrefs = usePreferencesStore((s) => s.update);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabIndex = workspace.activeTabIndex;
  const activeTab =
    activeTabIndex >= 0 && activeTabIndex < workspace.openTabs.length
      ? workspace.openTabs[activeTabIndex]
      : null;

  const loadFile = useTaskListStore((s) => s.loadFile);
  const clearSelection = useTaskListStore((s) => s.clearSelection);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const files = useTaskListStore((s) => s.files);

  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showMoveTasks, setShowMoveTasks] = useState(false);
  const [focusNewNoteSignal, setFocusNewNoteSignal] = useState(0);

  const hasActiveTab = activeTab !== null;
  const isUnifiedView = activeTab?.isUnifiedView ?? false;
  const filePath = activeTab?.filePath ?? "";
  const activePaneKey = activeTab?.isUnifiedView
    ? "__unified__"
    : activeTab?.filePath ?? "__none__";

  // Sidebar resize state.
  const MIN_SIDEBAR = 160;
  const MAX_SIDEBAR = 1280;
  const sidebarWidth = preferences.sidebarWidth ?? 320;
  const [dragWidth, setDragWidth] = useState(sidebarWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(sidebarWidth);

  // Sync dragWidth when preferences change externally (e.g. settings modal).
  useEffect(() => {
    if (!draggingRef.current) setDragWidth(sidebarWidth);
  }, [sidebarWidth]);

  const handleDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startXRef.current = e.clientX;
      startWidthRef.current = dragWidth;
      // Track the latest width in the drag's own closure so onUp can persist
      // it without putting a side effect inside a setState functional updater
      // (React 19's concurrent mode is allowed to invoke those more than once).
      let latestWidth = dragWidth;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        const clamped = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidthRef.current + delta));
        latestWidth = clamped;
        setDragWidth(clamped);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        updatePrefs({ sidebarWidth: latestWidth });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dragWidth, updatePrefs],
  );

  // Register global keyboard shortcuts.
  useKeyboardShortcuts(
    filePath,
    isUnifiedView,
    () => setShowNewTask(true),
    () => setShowMoveTasks(true),
    () => setFocusNewNoteSignal((value) => value + 1),
    () => setShowSettings(true),
    () => setShowShortcuts(true),
  );

  // Apply saved zoom level on startup and when changed.
  useEffect(() => {
    getCurrentWebview()
      .setZoom(preferences.zoomLevel)
      .catch((e) => console.warn("[zoom] Failed to set zoom:", e));
  }, [preferences.zoomLevel]);

  // Zoom keyboard shortcuts — separate effect so they work even when the gear menu
  // is open (the gear menu sets data-dropkick-interactive-layer, which suppresses
  // shortcuts in useKeyboardShortcuts; zoom should always be accessible).
  const zoomLevelRef = useRef(preferences.zoomLevel);
  useEffect(() => { zoomLevelRef.current = preferences.zoomLevel; }, [preferences.zoomLevel]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // If a focused layer (e.g. the New Task modal, which uses Cmd+0 for
      // priority) already handled this key, don't also zoom. Zoom stays
      // globally available otherwise, even with a menu or modal open.
      if (e.defaultPrevented) return;
      if (isZoomIn(e)) {
        e.preventDefault();
        updatePrefs({ zoomLevel: stepZoomIn(zoomLevelRef.current) });
      } else if (isZoomOut(e)) {
        e.preventDefault();
        updatePrefs({ zoomLevel: stepZoomOut(zoomLevelRef.current) });
      } else if (isZoomReset(e)) {
        e.preventDefault();
        updatePrefs({ zoomLevel: ZOOM_DEFAULT });
      } else if (
        hasPrimaryShortcutModifier(e) &&
        e.shiftKey &&
        matchesShortcutKey(e, "d")
      ) {
        // Quick dark-mode toggle. Like zoom, this lives outside
        // useKeyboardShortcuts so it stays available even when a menu/modal is
        // open. Read the latest value from the store to avoid a stale closure.
        e.preventDefault();
        updatePrefs({
          darkMode: !usePreferencesStore.getState().preferences.darkMode,
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [updatePrefs]);

  useEffect(() => {
    const title = activeTab ? `${activeTab.displayName} - Dropkick` : "Dropkick";
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch((e) => console.warn("[window] Failed to set title:", e));
  }, [activeTab?.displayName, activeTab?.filePath, activeTab?.isUnifiedView]);

  // Hold the window open until pending writes are on disk.
  //
  // Tauri would otherwise terminate the renderer the moment the OS sends the
  // close request. That defeats the "writes happen immediately" promise for
  // anything still in flight, and for anything committed only on blur (title /
  // description inputs, inline rename) where the user hits Cmd+Q while still
  // focused on the field. We intercept the close request, blur the active
  // element so its commit fires synchronously, wait for every per-path serial
  // chain to settle, and only then destroy the window.
  //
  // The mounted flag protects against the StrictMode mount → cleanup → mount
  // sequence so the listener is never double-registered or leaked.
  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;

    (async () => {
      const window = getCurrentWindow();
      const unlisten = await window.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          await drainAllSerial();
          await window.destroy();
        } catch (e) {
          // A rejection from destroy() leaves the window open. Better that
          // than an unhandled rejection with preventDefault already called —
          // the user can retry the close.
          console.error("[shutdown] Error closing window:", e);
        }
      });
      if (mounted) {
        unlistenFn = unlisten;
      } else {
        unlisten();
      }
    })();

    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, []);

  // Load the active tab's file when the active tab changes.
  useEffect(() => {
    (async () => {
      try {
        if (activeTab && !activeTab.isUnifiedView) {
          const result = await loadFile(activeTab.filePath);
          if (result.status !== "success") {
            await showMessage(
              "Open Task List Failed",
              loadFileErrorMessage(activeTab.filePath, result),
            );
          }
        }
        clearSelection();
      } catch (e) {
        console.error("Failed to load tab:", e);
        await showMessage(
          "Open Task List Failed",
          `The task list file could not be opened:\n\n${errorMessage(e)}`,
        );
      }
    })();
  }, [activeTab?.filePath, activeTab?.isUnifiedView]);

  // The set of open list file paths, order-independent, as a stable key. The
  // eager-load effect keys off this rather than `workspace.openTabs` so it only
  // re-runs when a list is actually opened or closed — not on a rename or a
  // drag-reorder, which rebuild the openTabs array without changing the set. NUL
  // is the separator because it cannot occur in a file path on any OS.
  const openListPathsKey = useMemo(
    () =>
      workspace.openTabs
        .filter((t) => !t.isUnifiedView)
        .map((t) => t.filePath)
        .sort()
        .join("\0"),
    [workspace.openTabs],
  );

  // Eagerly load every open list file — not just the active tab — so each tab's
  // deadline dot reflects its own list, and so unified view has every file's
  // tasks. The active tab is loaded by the effect above (which also shows a
  // dialog on failure), so it's skipped here to avoid a duplicate read.
  // loadFile records any failure in fileLoadErrors and never rejects, so a
  // background tab's failure surfaces inline (its alert icon and, in unified
  // view, the missing-lists notice in the task list pane).
  useEffect(() => {
    const paths = openListPathsKey ? openListPathsKey.split("\0") : [];
    for (const path of paths) {
      if (!activeTab?.isUnifiedView && path === activeTab?.filePath) continue;
      void loadFile(path);
    }
  }, [openListPathsKey, activeTab?.filePath, activeTab?.isUnifiedView, loadFile]);

  // File-lifecycle unload. The set of file paths the workspace currently has
  // open drives which files are kept in memory; anything that drops out gets
  // unloaded. This effect runs after React's commit phase, so any blur events
  // fired by inputs removed during unmount (e.g. a focused title input when
  // the user hits Cmd+W) have already triggered their store mutations and
  // queued their disk flushes. unloadFile then enters the per-path serial
  // chain behind those flushes — the pending write lands on disk first, then
  // the file's hash is forgotten.
  const openFilePaths = useMemo(
    () =>
      new Set(
        workspace.openTabs
          .filter((t) => !t.isUnifiedView)
          .map((t) => t.filePath),
      ),
    [workspace.openTabs],
  );
  const prevOpenFilePathsRef = useRef<Set<string>>(openFilePaths);
  useEffect(() => {
    const prev = prevOpenFilePathsRef.current;
    for (const path of prev) {
      if (!openFilePaths.has(path)) {
        void useTaskListStore.getState().unloadFile(path);
      }
    }
    prevOpenFilePathsRef.current = openFilePaths;
  }, [openFilePaths]);

  // Compute selected tasks for the move modal.
  const selectedTasks = useMemo(() => {
    if (!showMoveTasks || selectedKeys.size === 0) return [];
    const tasks: Task[] = [];
    if (isUnifiedView) {
      for (const tab of workspace.openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          const task = toTask(dto, tab.filePath, preferences.timezone, preferences.dueSoonDays);
          if (selectedKeys.has(taskSelectionKey(task))) tasks.push(task);
        }
      }
    } else {
      const fileState = files[filePath];
      if (fileState) {
        for (const dto of fileState.data.tasks) {
          const task = toTask(dto, filePath, preferences.timezone, preferences.dueSoonDays);
          if (selectedKeys.has(taskSelectionKey(task))) tasks.push(task);
        }
      }
    }
    return tasks;
  }, [showMoveTasks, selectedKeys, files, filePath, isUnifiedView, preferences.timezone, preferences.dueSoonDays, workspace.openTabs]);

  const visualTasks = useMemo(() => {
    const tasks: Task[] = [];
    if (isUnifiedView) {
      for (const tab of workspace.openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          tasks.push(toTask(dto, tab.filePath, preferences.timezone, preferences.dueSoonDays));
        }
      }
      return groupTasksForUnifiedView(tasks).groups.flatMap((group) => group.tasks);
    }

    const fileState = files[filePath];
    if (!fileState) return [];
    for (const dto of fileState.data.tasks) {
      tasks.push(toTask(dto, filePath, preferences.timezone, preferences.dueSoonDays));
    }
    return groupTasksForList(tasks).groups.flatMap((group) => group.tasks);
  }, [files, filePath, isUnifiedView, preferences.timezone, preferences.dueSoonDays, workspace.openTabs]);

  const nextActiveTaskKey = useMemo(
    () => pickNextActiveKey(selectedKeys, visualTasks),
    [selectedKeys, visualTasks],
  );

  useEffect(() => {
    if (showMoveTasks && selectedTasks.length === 0) {
      setShowMoveTasks(false);
    }
  }, [showMoveTasks, selectedTasks.length]);

  return (
    <div
      className="flex h-screen flex-col bg-background"
      style={{
        fontFamily: preferences.fontFamily,
      }}
    >
      {/* Tab bar */}
      <TabBar
        onGearMenuSelect={(item) => {
          if (item === "settings") setShowSettings(true);
          else if (item === "shortcuts") setShowShortcuts(true);
          else if (item === "about") setShowAbout(true);
        }}
      />

      {/* Content area */}
      {hasActiveTab ? (
        <div className="flex min-h-0 flex-1">
          {/* Left pane — task list */}
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-surface"
            style={{ width: dragWidth }}
          >
            <ErrorBoundary>
              <TaskListPane
                key={activePaneKey}
                filePath={filePath}
                isUnifiedView={isUnifiedView}
                onNewTask={() => setShowNewTask(true)}
              />
            </ErrorBoundary>
          </div>

          {/* Resize divider */}
          <div
            onMouseDown={handleDividerDown}
            className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary-accent active:bg-primary-accent-strong"
          />

          {/* Right pane — detail/summary/bulk */}
          <div className="h-full min-w-0 flex-1 overflow-hidden bg-surface">
            <ErrorBoundary>
              <TaskDetailPane
                key={activePaneKey}
                filePath={filePath}
                isUnifiedView={isUnifiedView}
                focusNewNoteSignal={focusNewNoteSignal}
              />
            </ErrorBoundary>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-ink-muted">
            <p className="text-lg">Welcome to Dropkick</p>
            <p className="mt-2 text-sm">
              Click the + button to open or create a task list.
            </p>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}

      {/* About modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* New task modal */}
      {showNewTask && (
        <NewTaskModal
          currentFilePath={filePath}
          isUnifiedView={isUnifiedView}
          onClose={() => setShowNewTask(false)}
        />
      )}

      {/* Move tasks modal */}
      {showMoveTasks && selectedTasks.length > 0 && (
        <MoveTasksModal
          selectedTasks={selectedTasks}
          sourceFilePath={filePath}
          isUnifiedView={isUnifiedView}
          nextActiveTaskKey={nextActiveTaskKey}
          onClose={() => setShowMoveTasks(false)}
        />
      )}
    </div>
  );
}

function loadFileErrorMessage(
  path: string,
  result:
    | { status: "missing" }
    | { status: "invalid"; message: string }
    | { status: "error"; message: string },
): string {
  if (result.status === "missing") {
    return `The task list file could not be found:\n\n${path}`;
  }
  return `The task list file could not be loaded:\n\n${path}\n\n${result.message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
