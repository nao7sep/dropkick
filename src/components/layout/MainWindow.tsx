// Main window — tab bar + two-panel layout (task list | task detail).

import { useEffect, useState, Component } from "react";
import type { ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import { TabBar } from "./TabBar";
import { SettingsModal } from "./SettingsModal";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { AboutModal } from "./AboutModal";
import { NewTaskModal } from "./NewTaskModal";
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
            <p className="text-sm text-red-600">{this.state.error}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MainWindow() {
  const preferences = usePreferencesStore((s) => s.preferences);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabIndex = workspace.activeTabIndex;
  const activeTab =
    activeTabIndex >= 0 && activeTabIndex < workspace.openTabs.length
      ? workspace.openTabs[activeTabIndex]
      : null;

  const loadFile = useTaskListStore((s) => s.loadFile);
  const clearSelection = useTaskListStore((s) => s.clearSelection);

  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);

  const hasActiveTab = activeTab !== null;
  const isUnifiedView = activeTab?.isUnifiedView ?? false;
  const filePath = activeTab?.filePath ?? "";

  // Register global keyboard shortcuts.
  useKeyboardShortcuts(filePath, isUnifiedView, () => setShowNewTask(true));

  // Apply saved zoom level on startup and when changed via settings.
  useEffect(() => {
    getCurrentWebview()
      .setZoom(preferences.zoomLevel)
      .catch((e) => console.warn("[zoom] Failed to set zoom:", e));
  }, [preferences.zoomLevel]);

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
          <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
            <ErrorBoundary>
              <TaskListPane filePath={filePath} isUnifiedView={isUnifiedView} onNewTask={() => setShowNewTask(true)} />
            </ErrorBoundary>
          </div>

          {/* Right pane — detail/summary/bulk */}
          <div className="h-full min-w-0 flex-1 overflow-y-auto bg-white">
            <ErrorBoundary>
              <TaskDetailPane filePath={filePath} isUnifiedView={isUnifiedView} />
            </ErrorBoundary>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-gray-400">
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
    </div>
  );
}
