// Main window — tab bar + two-panel layout (task list | task detail).

import { useEffect, useState, useRef, useCallback, useMemo, Component } from "react";
import type { ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  showMessage,
  log,
  toErrorFields,
} from "../../repositories";
import { usePreferencesStore } from "../../state/preferences-store";
import { useAppConfigStore } from "../../state/app-config-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { useNoteDraftStore } from "../../state/note-draft-store";
import { useKeyboardShortcuts } from "../../hooks/use-keyboard-shortcuts";
import { useWindowClose } from "../../hooks/use-window-close";
import { isComposingEvent } from "../../hooks/useComposing";
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
  clampSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  DETAIL_MIN_WIDTH,
  SPLITTER_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
} from "../../utils";
import {
  groupTasksForList,
  groupTasksForUnifiedView,
  draftReconcileSubjects,
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
  // Zoom and sidebar width are view state (state.json), not preferences.
  const zoomLevel = useAppConfigStore((s) => s.config.zoomLevel);
  const sidebarIntent = useAppConfigStore((s) => s.config.sidebarWidth);
  const updateViewState = useAppConfigStore((s) => s.updateViewState);
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

  // Sidebar resize state. The layout is an ADJUSTABLE sidebar (a fixed pixel width
  // set by dragging the splitter) plus a FILL detail pane that takes the remaining
  // space. Two distinct widths govern the sidebar:
  //
  //   - INTENT (persisted): the pixel width the user last dragged the sidebar to.
  //     Stored in state.json (AppConfigDto.sidebarWidth), updated ONLY on a splitter
  //     drag, never on a window resize. It is NOT clamped to the window — only the
  //     displayed width is.
  //   - DISPLAY (derived, ephemeral): clamp(SIDEBAR_MIN, intent, maxFit), where
  //     maxFit = containerWidth - DETAIL_MIN_WIDTH - SPLITTER_WIDTH. This is what
  //     the layout actually uses. When the window shrinks, the sidebar narrows
  //     toward SIDEBAR_MIN so the layout never breaks; when it grows back, the
  //     sidebar returns to exactly its intent because the intent never changed.
  //
  // containerWidth comes from a ResizeObserver on the content row and is used ONLY
  // to compute the displayed width — it is never persisted.
  const intent = sidebarIntent ?? DEFAULT_SIDEBAR_WIDTH;
  const contentRowRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // The live intent width during a drag; mirrors the persisted sidebarWidth
  // otherwise. Held in state so the sidebar tracks the cursor before the persist.
  const [dragIntent, setDragIntent] = useState(intent);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // Observe the content row's width so a window/container resize recomputes the
  // displayed sidebar width from the unchanged intent. Persists nothing.
  useEffect(() => {
    const el = contentRowRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasActiveTab]);

  // Sync dragIntent when the persisted intent changes externally (e.g. a
  // different preferences file loads). Skipped mid-drag so the live drag wins.
  useEffect(() => {
    if (draggingRef.current) return;
    setDragIntent(intent);
  }, [intent]);

  // The width fed to the layout: the intent clamped to what the current container
  // can display. Derived, never stored. During a drag dragIntent leads; otherwise
  // it mirrors the persisted intent.
  const sidebarWidth = useMemo(
    () => clampSidebarWidth(dragIntent, containerWidth),
    [dragIntent, containerWidth],
  );

  const handleDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      // Window-wide col-resize cursor for the whole drag (same pattern as the
      // tab drag's dnd-dragging class) — see App.css.
      document.body.classList.add("divider-dragging");
      startXRef.current = e.clientX;
      // The sidebar's displayed pixel width at drag start — the basis for turning
      // the cursor delta into the raw width the user is dragging to.
      startWidthRef.current = clampSidebarWidth(
        dragIntent,
        contentRowRef.current?.clientWidth ?? 0,
      );
      // Track the latest intent in the drag's own closure so onUp can persist it
      // without putting a side effect inside a setState functional updater
      // (React 19's concurrent mode is allowed to invoke those more than once).
      let latestIntent = dragIntent;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startXRef.current;
        // The raw width the user dragged to becomes the new intent. The intent is
        // NOT clamped to the window — only the displayed width is (clampSidebarWidth
        // in render). Floor at SIDEBAR_MIN so a drag past the left edge still
        // records a sane intent.
        const rawDraggedPx = Math.max(
          startWidthRef.current + delta,
          SIDEBAR_MIN_WIDTH,
        );
        latestIntent = rawDraggedPx;
        setDragIntent(rawDraggedPx);
      };

      const onUp = () => {
        draggingRef.current = false;
        document.body.classList.remove("divider-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Persist the intent (unclamped). Only a drag changes intent and persists.
        updateViewState({ sidebarWidth: latestIntent });
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dragIntent, updateViewState],
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
      .setZoom(zoomLevel)
      .catch((e) =>
        log.warn("webview setZoom failed", {
          zoomLevel,
          ...toErrorFields(e),
        }),
      );
  }, [zoomLevel]);

  // Zoom keyboard shortcuts — separate effect so they work even when the hamburger
  // menu is open (the menu sets data-dropkick-interactive-layer, which suppresses
  // shortcuts in useKeyboardShortcuts; zoom should always be accessible).
  const zoomLevelRef = useRef(zoomLevel);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // If a focused layer (e.g. the New Task modal, which uses Cmd+0 for
      // priority) already handled this key, don't also zoom. Zoom stays
      // globally available otherwise, even with a menu or modal open.
      if (e.defaultPrevented) return;
      // Mid-composition the chord belongs to the pending IME candidate —
      // matters on macOS where Ctrl+Semicolon is an IME conversion chord and
      // Semicolon is a zoom key (text-input-ime-conventions).
      if (isComposingEvent(e)) return;
      if (isZoomIn(e)) {
        e.preventDefault();
        updateViewState({ zoomLevel: stepZoomIn(zoomLevelRef.current) });
      } else if (isZoomOut(e)) {
        e.preventDefault();
        updateViewState({ zoomLevel: stepZoomOut(zoomLevelRef.current) });
      } else if (isZoomReset(e)) {
        e.preventDefault();
        updateViewState({ zoomLevel: ZOOM_DEFAULT });
      } else if (
        hasPrimaryShortcutModifier(e) &&
        e.shiftKey &&
        matchesShortcutKey(e, "d")
      ) {
        // Quick dark-mode toggle. Like zoom, this lives outside
        // useKeyboardShortcuts so it stays available even when a menu/modal is
        // open. darkMode is a preference (authored appearance setting), so it goes
        // through the preferences store — unlike zoom, which is view state. Read the
        // latest value from the store to avoid a stale closure.
        e.preventDefault();
        updatePrefs({
          darkMode: !usePreferencesStore.getState().preferences.darkMode,
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [updateViewState, updatePrefs]);

  useEffect(() => {
    const title = activeTab ? `${activeTab.displayName} - Dropkick` : "Dropkick";
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch((e) => log.warn("window setTitle failed", { title, ...toErrorFields(e) }));
  }, [activeTab?.displayName, activeTab?.filePath, activeTab?.isUnifiedView]);

  // Hold the window open until pending writes are on disk (see the hook for
  // which exits this can and cannot see).
  useWindowClose();

  // Load the active tab's file when the active tab changes.
  useEffect(() => {
    (async () => {
      try {
        if (activeTab && !activeTab.isUnifiedView) {
          const result = await loadFile(activeTab.filePath);
          if (result.status !== "success") {
            // The task-list store emits the load-failure warning; show the dialog.
            await showMessage(
              "Open Task List Failed",
              loadFileErrorMessage(activeTab.filePath, result),
            );
          }
        }
        clearSelection();
      } catch (e) {
        log.error("active tab open threw", {
          path: activeTab?.filePath,
          ...toErrorFields(e),
        });
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

  // Reconcile the persisted note drafts once the picture is complete.
  //
  // Drafts now outlive the session, so a task or note deleted while its draft
  // was parked would otherwise leave that draft behind for good — text with
  // nowhere to return to, that the user cannot reach from any surface.
  // Reconciliation can only DROP, so draftReconcileSubjects answers `null`
  // until every open list has loaded; this effect just retries until it does
  // and then runs exactly once for the session.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    const paths = openListPathsKey ? openListPathsKey.split("\0") : [];
    const subjects = draftReconcileSubjects(paths, files);
    if (!subjects) return;
    reconciledRef.current = true;
    useNoteDraftStore.getState().reconcile(subjects);
  }, [openListPathsKey, files]);

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
        onMenuSelect={(item) => {
          if (item === "settings") setShowSettings(true);
          else if (item === "shortcuts") setShowShortcuts(true);
          else if (item === "about") setShowAbout(true);
        }}
      />

      {/* Content area. A horizontal flex row: the ADJUSTABLE sidebar (a fixed
          pixel width, `shrink-0`), the splitter, then the FILL detail pane
          (`flex-1 min-w-0` with a real DETAIL_MIN_WIDTH). The sidebar's pixel
          width is the intent clamped to what this container can display
          (clampSidebarWidth); a resize recomputes it from the unchanged intent.
          Because the window minimum (setMinSize) equals the sum of both pane
          minimums plus the splitter, neither pane is ever squeezed below it. */}
      {hasActiveTab ? (
        <div ref={contentRowRef} className="flex min-h-0 flex-1">
          {/* Left pane — task list. The adjustable pane: fixed displayed pixel
              width, never shrinks below it (clampSidebarWidth floors at
              SIDEBAR_MIN_WIDTH). */}
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border bg-surface"
            style={{ width: `${sidebarWidth}px` }}
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

          {/* Resize divider — a fixed-width flex item. */}
          <div
            onMouseDown={handleDividerDown}
            className="shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary-accent active:bg-primary-accent-strong"
            style={{ width: `${SPLITTER_WIDTH}px` }}
          />

          {/* Right pane — detail/summary/bulk. The fill pane: `flex-1 min-w-0`
              takes the remaining space, with `min-width: DETAIL_MIN_WIDTH` so it
              never collapses below its content (overriding the flex item default
              that would otherwise let a widened sidebar squeeze it to nothing). */}
          <div
            className="h-full flex-1 min-w-0 overflow-hidden bg-surface"
            style={{ minWidth: `${DETAIL_MIN_WIDTH}px` }}
          >
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
