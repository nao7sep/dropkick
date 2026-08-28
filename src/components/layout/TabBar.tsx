// Tab bar — displays open tabs with drag-to-reorder, close, and rename.
// The [+] button opens a menu to create/open task list files.
// The hamburger icon opens a menu with Settings, Keyboard Shortcuts, and About.

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X, Layout, FileText, Menu, Settings, Keyboard, Info, Minus, AlertCircle } from "lucide-react";
import { singleLine, stepZoomIn, stepZoomOut, ZOOM_DEFAULT } from "../../utils";
import { computeTabUrgencies } from "../../services";
import type { ListUrgency } from "../../services";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import {
  Accessibility,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { planTabReorder } from "./tab-dnd";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useAppStateStore } from "../../state/app-state-store";
import { describeLoadFailure, fileNameWithoutExt } from "../../services";
import {
  openJsonFileDialog,
  saveJsonFileDialog,
  showMessage,
  log,
  toErrorFields,
} from "../../repositories";

type MenuItemId = "settings" | "shortcuts" | "about";

const TAB_DRAG_TYPE = "workspace-tab";

// Each tab is also its click-to-activate and double-click-to-rename surface.
// Immediate pointer activation would steal those ordinary tab interactions.
const TAB_POINTER_SENSOR = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 5 }),
  ],
});

// Shared styling for menu items. `data-[highlighted]` is Radix's active-item
// state (keyboard arrow focus and pointer hover both set it).
const MENU_ITEM_CLASS =
  "cursor-pointer px-4 py-2 text-left text-sm text-ink outline-none data-[highlighted]:bg-background";
const MENU_ITEM_ICON_CLASS =
  "flex cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-ink outline-none data-[highlighted]:bg-background";

interface TabBarProps {
  onMenuSelect: (item: MenuItemId) => void;
}

export function TabBar({ onMenuSelect }: TabBarProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  // Zoom is view state (state.json), not a preference — read/write via app-appState.
  const zoomLevel = useAppStateStore((s) => s.appState.zoomLevel);
  const updateViewState = useAppStateStore((s) => s.updateViewState);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const activeTabIndex = workspace.activeTabIndex;
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const reorderTabs = useWorkspaceStore((s) => s.reorderTabs);
  const workspacePersistenceError = useWorkspaceStore((s) => s.workspacePersistenceError);
  const dismissWorkspacePersistenceError = useWorkspaceStore((s) => s.dismissWorkspacePersistenceError);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);
  const addRecentFile = useWorkspaceStore((s) => s.addRecentFile);
  const loadFile = useTaskListStore((s) => s.loadFile);
  const createFile = useTaskListStore((s) => s.createFile);
  const fileLoadErrors = useTaskListStore((s) => s.fileLoadErrors);
  const files = useTaskListStore((s) => s.files);

  // Deadline urgency per open list tab, keyed by file path. Recomputed when the
  // open tabs, task data, load errors, or timezone change. MainWindow eagerly
  // loads every open list, so this reflects all tabs — not just the active one.
  const urgencyByTab = useMemo(
    () =>
      computeTabUrgencies(
        workspace.openTabs,
        files,
        new Set(Object.keys(fileLoadErrors)),
        preferences.timezone,
      ),
    [workspace.openTabs, files, fileLoadErrors, preferences.timezone],
  );

  // Identify the tab being renamed by its filePath (stable across reorder /
  // close / add). Unified view isn't renameable, so filePath uniquely
  // identifies any candidate.
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);

  // Focus rename input when editing starts.
  useEffect(() => {
    if (editingPath !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingPath]);

  // --- Drag-and-drop ---

  const handleDragEnd = async (event: DragEndEvent) => {
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (target === null || !isSortable(source)) return;
    const { initialIndex: fromIndex, index: toIndex } = source;
    if (fromIndex === toIndex) return;

    log.info("reorder tabs", { fromIndex, toIndex });
    try {
      await reorderTabs(fromIndex, toIndex);
    } catch (e) {
      log.error("reorder tabs failed", { fromIndex, toIndex, ...toErrorFields(e) });
    }
  };

  const handleKeyboardReorder = async (focusedId: string, direction: -1 | 1) => {
    const currentTabIds = useWorkspaceStore.getState().workspace.openTabs.map((tab) =>
      tab.isUnifiedView ? "__unified__" : tab.filePath,
    );
    const plan = planTabReorder(currentTabIds, focusedId, direction);
    if (!plan) return;

    log.info("reorder tabs", { ...plan });
    try {
      await reorderTabs(plan.fromIndex, plan.toIndex);
    } catch (e) {
      log.error("reorder tabs failed", { ...plan, ...toErrorFields(e) });
    }
  };

  // --- Tab actions ---

  const handleNewTaskList = async () => {
    try {
      const normalizedPath = await saveJsonFileDialog("tasks.json");
      if (!normalizedPath) return;
      log.info("create task list", { path: normalizedPath });
      await createFile(normalizedPath);
      const name = fileNameWithoutExt(normalizedPath);
      await addTab(normalizedPath, name);
      await addRecentFile(normalizedPath);
    } catch (e) {
      log.error("create task list failed", toErrorFields(e));
      await showMessage(
        "Create Task List Failed",
        `The task list file could not be created:\n\n${errorMessage(e)}`,
      );
    }
  };

  const handleOpenExisting = async () => {
    try {
      const path = await openJsonFileDialog();
      if (!path) return;
      log.info("open task list", { path });
      const loaded = await loadFile(path);
      if (loaded.status !== "success") {
        // The load-failure warning is emitted once by the task-list store
        // (covers this path and background loads); here we only show the dialog.
        await showMessage(
          "Open Task List Failed",
          describeLoadFailure("task list", loaded, path),
        );
        return;
      }
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      log.error("open task list threw", toErrorFields(e));
      await showMessage(
        "Open Task List Failed",
        `The task list file could not be opened:\n\n${errorMessage(e)}`,
      );
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      log.info("open recent task list", { path });
      const loaded = await loadFile(path);
      if (loaded.status !== "success") {
        // Load-failure warning is emitted once by the task-list store.
        await showMessage(
          "Open Task List Failed",
          describeLoadFailure("task list", loaded, path),
        );
        return;
      }
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      log.error("open recent task list threw", { path, ...toErrorFields(e) });
      await showMessage(
        "Open Recent File Failed",
        `The recent task list file could not be opened:\n\n${errorMessage(e)}`,
      );
    }
  };

  const handleUnifiedView = async () => {
    try {
      log.info("open unified view", {});
      await addUnifiedViewTab();
    } catch (e) {
      log.error("open unified view failed", toErrorFields(e));
      await showMessage(
        "Open Unified View Failed",
        `The unified view could not be opened:\n\n${errorMessage(e)}`,
      );
    }
  };

  const closeTabAt = async (index: number) => {
    const tab = workspace.openTabs[index];
    log.info("close tab", {
      index,
      ...(tab ? { unifiedView: tab.isUnifiedView, path: tab.filePath } : {}),
    });
    try {
      await closeTab(index);
    } catch (err) {
      log.error("close tab failed", { index, ...toErrorFields(err) });
    }
  };

  const handleCloseTab = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    void closeTabAt(index);
  };

  // Focus the tab at a given index by its stable data attribute, so arrow
  // navigation and post-close recovery move DOM focus to the right tab.
  const focusTabAt = (index: number) => {
    (
      tablistRef.current?.querySelector(
        `[data-tab-index="${index}"]`,
      ) as HTMLElement | null
    )?.focus();
  };

  // The tab bar is a tablist: one tab stop (the active tab), Left/Right move and
  // activate immediately (automatic activation — switching is cheap), Home/End
  // jump to the ends, Delete/Backspace closes the focused tab. The close glyph is
  // pointer-only and never its own tab stop.
  const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return; // inline rename
    const count = workspace.openTabs.length;
    if (count === 0) return;
    const current = workspace.activeTabIndex;
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const focusedId = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-id]")
        ?.dataset.tabId;
      if (focusedId) {
        void handleKeyboardReorder(focusedId, e.key === "ArrowLeft" ? -1 : 1);
      }
      return;
    }
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        e.preventDefault();
        const next = current + (e.key === "ArrowRight" ? 1 : -1);
        if (next < 0 || next >= count) return; // stop at the ends
        void setActiveTab(next);
        focusTabAt(next);
        return;
      }
      case "Home": {
        e.preventDefault();
        void setActiveTab(0);
        focusTabAt(0);
        return;
      }
      case "End": {
        e.preventDefault();
        void setActiveTab(count - 1);
        focusTabAt(count - 1);
        return;
      }
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        void closeTabAt(current);
        requestAnimationFrame(() => {
          focusTabAt(useWorkspaceStore.getState().workspace.activeTabIndex);
        });
        return;
      }
      default:
        return;
    }
  };

  const handleDoubleClick = (index: number) => {
    const tab = workspace.openTabs[index];
    if (!tab || tab.isUnifiedView) return;
    setEditingPath(tab.filePath);
    setEditValue(tab.displayName);
  };

  const handleRenameSubmit = async () => {
    if (editingPath !== null) {
      const cleaned = singleLine(editValue, { minify: true });
      if (cleaned) {
        log.info("rename tab", { path: editingPath, displayName: cleaned });
        try {
          await renameTab(editingPath, cleaned);
        } catch (e) {
          log.error("rename tab failed", { path: editingPath, ...toErrorFields(e) });
        }
      }
    }
    setEditingPath(null);
  };

  const recentFiles = workspace.recentFiles.filter(
    (r) => !workspace.openTabs.some((t) => t.filePath === r.filePath),
  );

  return (
    <DragDropProvider
      // Replacing the defaults removes dnd-kit's KeyboardSensor. The tablist
      // already owns one roving tab stop and Shift+Arrow reorder through the
      // same durable operation, so per-tab keyboard drag is a conflicting path.
      sensors={[TAB_POINTER_SENSOR]}
      // Accessibility would add button semantics, tabindex, and keyboard-drag
      // instructions to the sortable tabs. Preserve the tablist's native tab
      // semantics by retaining every default plugin except that one.
      plugins={(defaults) =>
        defaults.filter((plugin) => plugin !== Accessibility)
      }
      onDragEnd={(event) => { void handleDragEnd(event); }}
    >
      <div className="flex min-h-10 flex-wrap items-center border-b border-border bg-surface">
          {/* The tablist wrapper is display:contents (creates no box), so every
              tab flows directly in this wrapping row alongside the New button.
              This keeps every open tab visible instead of hiding tabs in a
              horizontal scroll strip. */}
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Open task lists"
            onKeyDown={handleTablistKeyDown}
            className="contents"
          >
            {workspace.openTabs.map((tab, index) => {
            const hasLoadError =
              !tab.isUnifiedView && fileLoadErrors[tab.filePath] !== undefined;
            // Unified view never gets a dot; computeTabUrgencies returns an
            // entry (possibly null) for every other open tab — load-errored and
            // not-yet-loaded ones resolve to null there. The `?? null` keeps the
            // type honest if a tab is ever rendered before the memo covers it.
            const urgency: ListUrgency = tab.isUnifiedView
              ? null
              : urgencyByTab[tab.filePath] ?? null;
            return (
              <SortableTab
                key={tab.isUnifiedView ? "__unified__" : tab.filePath}
                id={tab.isUnifiedView ? "__unified__" : tab.filePath}
                tab={tab}
                hasLoadError={hasLoadError}
                urgency={urgency}
                index={index}
                isActive={index === activeTabIndex}
                isEditing={!tab.isUnifiedView && editingPath === tab.filePath}
                editValue={editValue}
                editInputRef={
                  !tab.isUnifiedView && editingPath === tab.filePath
                    ? editInputRef
                    : undefined
                }
                onActivate={() => setActiveTab(index)}
                onDoubleClick={() => handleDoubleClick(index)}
                onClose={(e) => handleCloseTab(e, index)}
                onEditChange={setEditValue}
                onEditSubmit={handleRenameSubmit}
                onEditCancel={() => setEditingPath(null)}
              />
            );
            })}
          </div>

          {/* New-list menu */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="New or open task list"
                className="flex h-10 w-10 shrink-0 items-center justify-center text-primary transition-colors hover:bg-primary-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ring"
              >
                <Plus size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-dropkick-interactive-layer=""
                align="start"
                sideOffset={4}
                className="z-50 w-64 rounded-md border border-border bg-surface py-1 text-ink shadow-lg"
              >
                <DropdownMenu.Item
                  onSelect={handleNewTaskList}
                  className={MENU_ITEM_CLASS}
                >
                  New task list...
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={handleOpenExisting}
                  className={MENU_ITEM_CLASS}
                >
                  Open existing file...
                </DropdownMenu.Item>
                {!workspace.openTabs.some((t) => t.isUnifiedView) && (
                  <DropdownMenu.Item
                    onSelect={handleUnifiedView}
                    className={MENU_ITEM_CLASS}
                  >
                    Unified view
                  </DropdownMenu.Item>
                )}

                {recentFiles.length > 0 && (
                  <>
                    <DropdownMenu.Separator className="my-1 border-t border-border-subtle" />
                    <DropdownMenu.Label className="px-4 py-1 text-xs font-medium text-ink-muted">
                      Recent
                    </DropdownMenu.Label>
                    {recentFiles.slice(0, 10).map((r) => (
                      <DropdownMenu.Item
                        key={r.filePath}
                        onSelect={() => handleOpenRecent(r.filePath)}
                        className="cursor-pointer px-4 py-1.5 text-left text-sm text-ink-soft outline-none data-[highlighted]:bg-background"
                      >
                        <span className="block truncate" title={r.filePath}>
                          {fileNameWithoutExt(r.filePath)}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {r.filePath}
                        </span>
                      </DropdownMenu.Item>
                    ))}
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Spacer pushes the hamburger menu to the right edge. */}
          <div className="flex-1" />

          {/* Hamburger menu */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="Menu"
                title="Menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ring"
              >
                <Menu size={18} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-dropkick-interactive-layer=""
                align="end"
                sideOffset={4}
                className="z-50 w-52 rounded-md border border-border bg-surface py-1 text-ink shadow-lg"
              >
                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("settings")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Settings size={14} className="text-ink-muted" />
                  Settings
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("shortcuts")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Keyboard size={14} className="text-ink-muted" />
                  Keyboard Shortcuts
                </DropdownMenu.Item>

                {/* Zoom — a non-menuitem control embedded in the menu: arrow
                    navigation skips it, and it is driven by pointer and by the
                    global zoom shortcuts. Left exactly as the standalone control. */}
                <DropdownMenu.Separator className="my-1 border-t border-border-subtle" />
                <div className="flex items-center justify-center gap-3 px-3 py-1.5">
                  <span className="text-sm text-ink-soft">Zoom</span>
                  <div className="flex items-center overflow-hidden rounded border border-border">
                    <button
                      onClick={() => {
                        const next = stepZoomOut(zoomLevel);
                        if (next !== zoomLevel) updateViewState({ zoomLevel: next });
                      }}
                      disabled={stepZoomOut(zoomLevel) === zoomLevel}
                      className="flex h-6 w-6 items-center justify-center bg-surface text-ink-muted hover:bg-background disabled:opacity-30"
                      title="Zoom out"
                    >
                      <Minus size={12} />
                    </button>
                    {zoomLevel !== ZOOM_DEFAULT ? (
                      <button
                        onClick={() => updateViewState({ zoomLevel: ZOOM_DEFAULT })}
                        className="w-10 border-x border-border bg-surface text-center text-xs tabular-nums text-primary hover:text-primary-hover leading-6"
                        title="Reset to 100%"
                      >
                        {Math.round(zoomLevel * 100)}%
                      </button>
                    ) : (
                      <span className="w-10 border-x border-border bg-surface text-center text-xs tabular-nums text-ink leading-6">
                        {Math.round(zoomLevel * 100)}%
                      </span>
                    )}
                    <button
                      onClick={() => {
                        const next = stepZoomIn(zoomLevel);
                        if (next !== zoomLevel) updateViewState({ zoomLevel: next });
                      }}
                      disabled={stepZoomIn(zoomLevel) === zoomLevel}
                      className="flex h-6 w-6 items-center justify-center bg-surface text-ink-muted hover:bg-background disabled:opacity-30"
                      title="Zoom in"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <DropdownMenu.Separator className="my-1 border-t border-border-subtle" />

                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("about")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Info size={14} className="text-ink-muted" />
                  About Dropkick
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
      </div>
      {workspacePersistenceError ? (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1">{workspacePersistenceError}</span>
          <button
            type="button"
            aria-label="Dismiss workspace save error"
            title="Dismiss"
            onClick={dismissWorkspacePersistenceError}
            className="shrink-0 rounded p-0.5 text-danger hover:bg-danger-surface-strong"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </DragDropProvider>
  );
}

// --- Sortable tab item ---

// Deadline dot shown on a tab: red when the list holds an overdue task, orange
// when it holds one due today. Colors track the Past Due / Due Today groups.
const URGENCY_DOT_COLOR: Record<NonNullable<ListUrgency>, string> = {
  PastDue: "bg-group-pastdue-accent",
  DueToday: "bg-group-duetoday-accent",
};

const URGENCY_LABEL: Record<NonNullable<ListUrgency>, string> = {
  PastDue: "Has past-due tasks",
  DueToday: "Has tasks due today",
};

interface SortableTabProps {
  id: string;
  tab: { isUnifiedView: boolean; displayName: string; filePath: string };
  hasLoadError: boolean;
  urgency: ListUrgency;
  index: number;
  isActive: boolean;
  isEditing: boolean;
  editValue: string;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  onActivate: () => void;
  onDoubleClick: () => void;
  onClose: (e: React.MouseEvent) => void;
  onEditChange: (value: string) => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
}

function SortableTab({
  id,
  tab,
  hasLoadError,
  urgency,
  index,
  isActive,
  isEditing,
  editValue,
  editInputRef,
  onActivate,
  onDoubleClick,
  onClose,
  onEditChange,
  onEditSubmit,
  onEditCancel,
}: SortableTabProps) {
  // The current sortable hook registers pointer transport without adding DOM
  // attributes. The tablist remains the sole owner of role and roving focus.
  const { ref, isDragging } = useSortable({
    id,
    index,
    type: TAB_DRAG_TYPE,
    accept: TAB_DRAG_TYPE,
    group: TAB_DRAG_TYPE,
  });
  const composing = useComposing();

  const style = {
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={ref}
      style={style}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      data-tab-index={index}
      data-tab-id={id}
      onClick={onActivate}
      onDoubleClick={onDoubleClick}
      title={hasLoadError ? `Load failed: ${tab.filePath}` : undefined}
      className={`group flex shrink-0 cursor-grab items-center gap-1.5 border-r border-border px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ring ${
        isActive
          ? "bg-primary-surface text-primary-hover"
          : "text-ink hover:bg-background"
      }`}
    >
      {urgency && (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT_COLOR[urgency]}`}
          title={URGENCY_LABEL[urgency]}
        />
      )}

      {hasLoadError ? (
        <AlertCircle size={14} className="shrink-0 text-danger" />
      ) : tab.isUnifiedView ? (
        <Layout size={14} className="shrink-0" />
      ) : (
        <FileText size={14} className="shrink-0" />
      )}

      {isEditing ? (
        <input
          ref={editInputRef}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEditSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              onEditSubmit();
            }
            if (e.key === "Escape") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              onEditCancel();
            }
          }}
          {...composing.handlers}
          className="w-24 rounded border border-primary-ring px-1 text-sm outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="max-w-32 truncate">{tab.displayName}</span>
      )}

      <button
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close tab"
        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-surface-muted group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}



function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
