// Tab bar — displays open tabs with drag-to-reorder, close, and rename.
// The [+] button opens a menu to create/open task list files.
// The hamburger icon opens a menu with Settings, Records, Zoom, Keyboard Shortcuts, and About.

import { useState, useRef, useEffect, useMemo } from "react";
import { Plus, X, Layout, FileText, Menu, Settings, Keyboard, Info, Minus, AlertCircle, ScrollText, ZoomIn } from "lucide-react";
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
import { useI18n } from "../../i18n/I18nContext";
import type { MessageKey } from "../../i18n/catalogues";
import { message } from "../../i18n/translate";

type MenuItemId = "settings" | "records" | "shortcuts" | "about";

const TAB_DRAG_TYPE = "workspace-tab";

// Each tab is also its click-to-activate and double-click-to-rename surface.
// Immediate pointer activation would steal those ordinary tab interactions.
const TAB_POINTER_SENSOR = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 5 }),
  ],
});

// Menu items are inset, rounded rows (App.css `dk-menu-item`); Radix's
// `data-highlighted` marks the active item for pointer and keyboard alike.
const MENU_ITEM_CLASS = "dk-menu-item";
const MENU_ITEM_ICON_CLASS = "dk-menu-item";

interface TabBarProps {
  onMenuSelect: (item: MenuItemId) => void;
  onChromeHeightChange: (height: number) => void;
}

export function TabBar({ onMenuSelect, onChromeHeightChange }: TabBarProps) {
  const i18n = useI18n();
  const { t } = i18n;
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
  const fileDiskErrors = useTaskListStore((s) => s.fileDiskErrors);
  const unsavedFiles = useTaskListStore((s) => s.unsavedFiles);
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
  const chromeRef = useRef<HTMLDivElement>(null);

  // The tab row deliberately wraps so every open list stays visible. Report the
  // resulting chrome height rather than assuming one row: the app shell adds it
  // to the content minimum and updates the native window floor. The same
  // measurement naturally includes the persistent workspace-error strip.
  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;

    const reportHeight = () => {
      const height = Math.ceil(chrome.getBoundingClientRect().height);
      if (height > 0) onChromeHeightChange(height);
    };

    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [onChromeHeightChange]);

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
      await showMessage(message("tabs.createFailed.title"), message("tabs.createFailed.body"));
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
          message("tabs.openFailed.title"),
          describeLoadFailure("taskList", loaded, path),
        );
        return;
      }
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      log.error("open task list threw", toErrorFields(e));
      await showMessage(message("tabs.openFailed.title"), message("tabs.openFailed.body"));
    }
  };

  const handleOpenRecent = async (path: string) => {
    try {
      log.info("open recent task list", { path });
      const loaded = await loadFile(path);
      if (loaded.status !== "success") {
        // Load-failure warning is emitted once by the task-list store.
        await showMessage(
          message("tabs.openFailed.title"),
          describeLoadFailure("taskList", loaded, path),
        );
        return;
      }
      const name = fileNameWithoutExt(path);
      await addTab(path, name);
      await addRecentFile(path);
    } catch (e) {
      log.error("open recent task list threw", { path, ...toErrorFields(e) });
      await showMessage(message("tabs.openRecentFailed.title"), message("tabs.openRecentFailed.body"));
    }
  };

  const handleUnifiedView = async () => {
    try {
      log.info("open unified view", {});
      await addUnifiedViewTab();
    } catch (e) {
      log.error("open unified view failed", toErrorFields(e));
      await showMessage(message("tabs.unifiedFailed.title"), message("tabs.unifiedFailed.body"));
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
      <div ref={chromeRef} className="shrink-0">
        {/* The bar is two columns: the tabs wrap in their own area, and the menu
            keeps the window's top-right corner, level with the first tab row
            however many rows follow. The menu sits outside the tablist and is
            no sortable, so a tab drag can end last, beside it, and nothing
            starts or lands on the menu. */}
        <div className="flex items-start border-b border-border bg-surface">
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-0.5 px-1 py-1">
          {/* The tablist wrapper is display:contents (creates no box), so every
              tab flows directly in this wrapping row alongside the New button.
              This keeps every open tab visible instead of hiding tabs in a
              horizontal scroll strip. */}
          <div
            ref={tablistRef}
            role="tablist"
            aria-label={t("tabs.label")}
            onKeyDown={handleTablistKeyDown}
            className="contents"
          >
            {workspace.openTabs.map((tab, index) => {
            const hasLoadError =
              !tab.isUnifiedView &&
              (fileLoadErrors[tab.filePath] !== undefined ||
                fileDiskErrors[tab.filePath] !== undefined);
            const isUnsaved =
              !tab.isUnifiedView && unsavedFiles[tab.filePath] !== undefined;
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
                isUnsaved={isUnsaved}
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
                aria-label={t("tabs.newOrOpen")}
                className="dk-icon-btn h-8 w-8 text-primary"
              >
                <Plus size={16} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-dropkick-interactive-layer=""
                align="start"
                sideOffset={4}
                className="dk-menu z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-max min-w-64 max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto"
              >
                <DropdownMenu.Item
                  onSelect={handleNewTaskList}
                  className={MENU_ITEM_CLASS}
                >
                  {t("tabs.newList")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={handleOpenExisting}
                  className={MENU_ITEM_CLASS}
                >
                  {t("tabs.openExisting")}
                </DropdownMenu.Item>
                {!workspace.openTabs.some((t) => t.isUnifiedView) && (
                  <DropdownMenu.Item
                    onSelect={handleUnifiedView}
                    className={MENU_ITEM_CLASS}
                  >
                    {t("tabs.unifiedMenu")}
                  </DropdownMenu.Item>
                )}

                {recentFiles.length > 0 && (
                  <>
                    <DropdownMenu.Separator className="dk-menu-separator" />
                    <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-muted">
                      {t("tabs.recent")}
                    </DropdownMenu.Label>
                    {recentFiles.slice(0, 10).map((r) => (
                      <DropdownMenu.Item
                        key={r.filePath}
                        onSelect={() => handleOpenRecent(r.filePath)}
                        className="dk-menu-item block text-ink-soft"
                      >
                        <span className="block w-0 min-w-full truncate" title={r.filePath}>
                          {fileNameWithoutExt(r.filePath)}
                        </span>
                        <span className="block w-0 min-w-full truncate text-xs text-ink-muted">
                          {r.filePath}
                        </span>
                      </DropdownMenu.Item>
                    ))}
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

        </div>

          {/* Hamburger menu — its own fixed column at the top-right corner. */}
          <div className="shrink-0 py-1 pr-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={t("menu.label")}
                title={t("menu.label")}
                className="dk-icon-btn h-8 w-8"
              >
                <Menu size={18} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-dropkick-interactive-layer=""
                align="end"
                sideOffset={4}
                className="dk-menu z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-max min-w-52 max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto"
              >
                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("settings")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Settings size={14} className="text-ink-muted" />
                  {t("menu.settings")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("records")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <ScrollText size={14} className="text-ink-muted" />
                  {t("menu.records")}
                </DropdownMenu.Item>
                {/* Zoom — a non-menuitem control embedded in the menu: arrow
                    navigation skips it, and it is driven by pointer and by the
                    global zoom shortcuts. The row shares the item anatomy, so
                    its icon and label sit in the items' columns. */}
                <DropdownMenu.Separator className="dk-menu-separator" />
                <div className="dk-menu-control">
                  <ZoomIn size={14} className="text-ink-muted" />
                  <span className="flex-1">{t("menu.zoom")}</span>
                  <div className="flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-control-edge bg-control">
                    <button
                      onClick={() => {
                        const next = stepZoomOut(zoomLevel);
                        if (next !== zoomLevel) updateViewState({ zoomLevel: next });
                      }}
                      disabled={stepZoomOut(zoomLevel) === zoomLevel}
                      className="flex h-7 w-7 items-center justify-center text-ink-soft transition-colors hover:bg-control-hover active:bg-control-pressed disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
                      title={t("menu.zoomOut")}
                    >
                      <Minus size={12} />
                    </button>
                    {zoomLevel !== ZOOM_DEFAULT ? (
                      <button
                        onClick={() => updateViewState({ zoomLevel: ZOOM_DEFAULT })}
                        className="h-7 w-12 border-x border-control-edge text-center text-xs tabular-nums leading-7 text-primary transition-colors hover:bg-control-hover hover:text-primary-hover active:bg-control-pressed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
                        title={t("menu.zoomReset", { percent: i18n.percent(ZOOM_DEFAULT) })}
                      >
                        {i18n.percent(zoomLevel)}
                      </button>
                    ) : (
                      <span className="h-7 w-12 border-x border-control-edge text-center text-xs tabular-nums leading-7 text-ink">
                        {i18n.percent(zoomLevel)}
                      </span>
                    )}
                    <button
                      onClick={() => {
                        const next = stepZoomIn(zoomLevel);
                        if (next !== zoomLevel) updateViewState({ zoomLevel: next });
                      }}
                      disabled={stepZoomIn(zoomLevel) === zoomLevel}
                      className="flex h-7 w-7 items-center justify-center text-ink-soft transition-colors hover:bg-control-hover active:bg-control-pressed disabled:opacity-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
                      title={t("menu.zoomIn")}
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <DropdownMenu.Separator className="dk-menu-separator" />

                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("shortcuts")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Keyboard size={14} className="text-ink-muted" />
                  {t("menu.shortcuts")}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => onMenuSelect("about")}
                  className={MENU_ITEM_ICON_CLASS}
                >
                  <Info size={14} className="text-ink-muted" />
                  {t("menu.about")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          </div>
        </div>
        {workspacePersistenceError ? (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2 border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong"
          >
            <span className="min-w-0 flex-1">{i18n.text(workspacePersistenceError)}</span>
            <button
              type="button"
              aria-label={t("tabs.dismissSaveError")}
              title={t("common.dismiss")}
              onClick={dismissWorkspacePersistenceError}
              className="dk-icon-btn dk-icon-btn-xs dk-icon-btn-on-danger dk-line-dismiss"
            >
              <X size={13} />
            </button>
          </div>
        ) : null}
      </div>
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

const URGENCY_LABEL: Record<NonNullable<ListUrgency>, MessageKey> = {
  PastDue: "tabs.hasPastDue",
  DueToday: "tabs.hasDueToday",
};

interface SortableTabProps {
  id: string;
  tab: { isUnifiedView: boolean; displayName: string; filePath: string };
  hasLoadError: boolean;
  isUnsaved: boolean;
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
  isUnsaved,
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
  const { t } = useI18n();

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
      title={
        hasLoadError
          ? t("tabs.loadFailed", { path: tab.filePath })
          : isUnsaved
            ? t("tabs.notSaved", { path: tab.filePath })
            : undefined
      }
      // A tab is a rounded item in the strip: the chosen one takes the accent
      // wash, the rest a hover step. No dividers or folder shapes.
      className={`group flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-[var(--radius-control)] pl-3 pr-1.5 text-sm transition-colors duration-[var(--motion)] focus:outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring ${
        isActive
          ? "bg-primary-surface font-medium text-primary-hover"
          : "text-ink-soft hover:bg-control-hover hover:text-ink"
      }`}
    >
      {urgency && (
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT_COLOR[urgency]}`}
          title={t(URGENCY_LABEL[urgency])}
        />
      )}

      {hasLoadError || isUnsaved ? (
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
          className="h-6 w-28 rounded-[var(--radius-sm)] border border-primary-ring bg-surface px-1.5 text-sm text-ink outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="max-w-32 truncate">
          {tab.isUnifiedView ? t("tabs.unified") : tab.displayName}
        </span>
      )}

      <button
        onClick={onClose}
        tabIndex={-1}
        aria-label={t("tabs.close")}
        className="dk-icon-btn dk-icon-btn-xs h-5 w-5 opacity-0 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}
