// Main window — tab bar + two-panel layout (task list | task detail).

import { useEffect, useState, useRef, useCallback, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import { toTask } from "../../utils";
import { TabBar } from "./TabBar";
import { SettingsModal } from "./SettingsModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { AboutModal } from "./AboutModal";
import { NewTaskModal } from "./NewTaskModal";
import { MoveTasksModal } from "./MoveTasksModal";
import { TaskListPane } from "../task-list/TaskListPane";
import { TaskDetailPane } from "../task-detail/TaskDetailPane";

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
          <div className="max-w-md rounded-lg bg-red-50 p-6">
            <h3 className="mb-2 font-bold text-red-700">Rendering Error</h3>
            <p className="text-sm text-red-700">{this.state.error}</p>
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
  const selectedIds = useTaskListStore((s) => s.selectedIds);
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

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        const clamped = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, startWidthRef.current + delta));
        setDragWidth(clamped);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Persist the final width.
        setDragWidth((w) => {
          updatePrefs({ sidebarWidth: w });
          return w;
        });
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
  );

  // Apply saved zoom level on startup and when changed via settings.
  useEffect(() => {
    getCurrentWebview()
      .setZoom(preferences.zoomLevel)
      .catch((e) => console.warn("[zoom] Failed to set zoom:", e));
  }, [preferences.zoomLevel]);

  useEffect(() => {
    const title = activeTab ? `${activeTab.displayName} - Dropkick` : "Dropkick";
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch((e) => console.warn("[window] Failed to set title:", e));
  }, [activeTab?.displayName, activeTab?.filePath, activeTab?.isUnifiedView]);

  // Load the active tab's file when the active tab changes.
  useEffect(() => {
    (async () => {
      try {
        if (activeTab && !activeTab.isUnifiedView) {
          await loadFile(activeTab.filePath);
        }
        clearSelection();
      } catch (e) {
        console.error("Failed to load tab:", e);
      }
    })();
  }, [activeTab?.filePath, activeTab?.isUnifiedView]);

  // For unified view, load all tab files.
  useEffect(() => {
    if (!activeTab?.isUnifiedView) return;
    (async () => {
      try {
        for (const tab of workspace.openTabs) {
          if (!tab.isUnifiedView) {
            await loadFile(tab.filePath);
          }
        }
      } catch (e) {
        console.error("Failed to load files for unified view:", e);
      }
    })();
  }, [activeTab?.isUnifiedView, workspace.openTabs.length]);

  // Compute selected tasks for the move modal.
  const selectedTasks = useMemo(() => {
    if (!showMoveTasks || selectedIds.size === 0) return [];
    const tasks = [];
    if (isUnifiedView) {
      for (const tab of workspace.openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          if (selectedIds.has(dto.id)) tasks.push(toTask(dto, tab.filePath, preferences.timezone, preferences.dueSoonDays));
        }
      }
    } else {
      const fileState = files[filePath];
      if (fileState) {
        for (const dto of fileState.data.tasks) {
          if (selectedIds.has(dto.id)) tasks.push(toTask(dto, filePath, preferences.timezone, preferences.dueSoonDays));
        }
      }
    }
    return tasks;
  }, [showMoveTasks, selectedIds, files, filePath, isUnifiedView, preferences.timezone, preferences.dueSoonDays, workspace.openTabs]);

  useEffect(() => {
    if (showMoveTasks && selectedTasks.length === 0) {
      setShowMoveTasks(false);
    }
  }, [showMoveTasks, selectedTasks.length]);

  return (
    <div
      className="flex h-screen flex-col bg-gray-50"
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
            className="flex h-full shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white"
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
            className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-sky-300 active:bg-sky-400"
          />

          {/* Right pane — detail/summary/bulk */}
          <div className="h-full min-w-0 flex-1 overflow-hidden bg-white">
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
          <div className="text-center text-gray-500">
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
          onClose={() => setShowMoveTasks(false)}
        />
      )}
    </div>
  );
}
