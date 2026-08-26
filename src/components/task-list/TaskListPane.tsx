// Left pane — displays tasks grouped by priority/due rules.
// Supports selection (click, Shift+click, Cmd+click on macOS / Ctrl+click on Windows).

import { useState, useRef, useMemo, useEffect } from "react";
import { Plus, AlertCircle, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { Task, TaskGroup } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { showMessage } from "../../repositories";
import {
  singleLine,
  hasPointerCommandModifier,
  primaryModifierLabel,
  taskSelectionKey,
  rowDomId,
  stepIndex,
  pageStepIndex,
  rangeKeysBetween,
  planRangeSelection,
  planListArrowDown,
  type ListArrowDownPlan,
} from "../../utils";
import {
  summarizeUnifiedLoadState,
  taskListEmptyMessage,
} from "../../services";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useViewTasks } from "../../hooks/useViewTasks";
import { describeLoadFailure, fileNameWithoutExt } from "../../services";

interface TaskListPaneProps {
  filePath: string;
  isUnifiedView: boolean;
  onNewTask: () => void;
}

const GROUP_COLORS: Record<TaskGroup, string> = {
  PastDue: "text-group-pastdue-fg border-group-pastdue-border",
  Critical: "text-group-critical-fg border-group-critical-border",
  DueToday: "text-group-duetoday-fg border-group-duetoday-border",
  Important: "text-group-important-fg border-group-important-border",
  Urgent: "text-group-urgent-fg border-group-urgent-border",
  DueSoon: "text-group-duesoon-fg border-group-duesoon-border",
  Default: "text-ink-soft border-border",
};

const GROUP_BORDERS: Record<TaskGroup, string> = {
  PastDue: "border-l-group-pastdue-accent",
  Critical: "border-l-group-critical-accent",
  DueToday: "border-l-group-duetoday-accent",
  Important: "border-l-group-important-accent",
  Urgent: "border-l-group-urgent-accent",
  DueSoon: "border-l-group-duesoon-accent",
  Default: "border-l-transparent",
};

// Rows moved per PageUp/PageDown press. A fixed step rather than a measured
// viewport — predictable, and the list rarely needs pixel-accurate paging.
const LIST_PAGE = 10;

const GROUP_BGS: Record<TaskGroup, string> = {
  PastDue: "bg-group-pastdue-tint/60",
  Critical: "bg-group-critical-tint/60",
  DueToday: "bg-group-duetoday-tint/60",
  Important: "bg-group-important-tint/60",
  Urgent: "bg-group-urgent-tint/60",
  DueSoon: "bg-group-duesoon-tint/60",
  Default: "",
};

export function TaskListPane({ filePath, isUnifiedView, onNewTask }: TaskListPaneProps) {
  const pageSize = usePreferencesStore((s) => s.preferences.handledTasksPageSize);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const reorderTick = useTaskListStore((s) => s.reorderTick);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const showMoreHandled = useTaskListStore((s) => s.showMoreHandled);
  const setHandledExpanded = useTaskListStore((s) => s.setHandledExpanded);
  const fileLoadError = useTaskListStore((s) => s.fileLoadErrors[filePath]);
  const fileLoadErrors = useTaskListStore((s) => s.fileLoadErrors);
  const loadFile = useTaskListStore((s) => s.loadFile);
  const activeTabIndex = useWorkspaceStore((s) => s.workspace.activeTabIndex);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const viewKey = isUnifiedView ? "__unified__" : filePath;
  const handledVisible = useTaskListStore(
    (s) => s.handledVisible[viewKey] ?? pageSize,
  );
  const handledExpanded = useTaskListStore(
    (s) => s.handledExpanded[viewKey] ?? false,
  );

  const files = useTaskListStore((s) => s.files);
  const openTabs = useWorkspaceStore((s) => s.workspace.openTabs);

  const { grouped } = useViewTasks(filePath, isUnifiedView);

  // In unified view, the merged list silently omits any open list whose file
  // isn't loaded — whether it failed or is still loading. Summarize both so the
  // pane can show the roll-up is incomplete rather than passing a partial merge
  // off as the whole picture. Cheap and skipped entirely outside unified view.
  const unifiedLoad = useMemo(() => {
    if (!isUnifiedView) return { failedNames: [], loadingCount: 0 };
    return summarizeUnifiedLoadState(
      openTabs,
      new Set(Object.keys(files)),
      new Set(Object.keys(fileLoadErrors)),
    );
  }, [isUnifiedView, openTabs, files, fileLoadErrors]);
  const visibleHandled = grouped.handled.slice(0, handledVisible);
  const emptyMessage = taskListEmptyMessage(grouped, handledExpanded);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // The listbox container is the single tab stop; DOM focus lives here while the
  // list is active, so a row unmounting (e.g. a completed task collapsing into
  // Handled) never drops focus to <body>. anchorRef pins one end of a keyboard
  // range selection.
  const listRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<string | null>(null);
  const dominantSelectedKey = useMemo(() => {
    const keys = [...selectedKeys];
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }, [selectedKeys]);

  // Active-task keys and visible-handled keys in visual order, kept separate so
  // the "expand into Handled" path can build the post-expand domain before the
  // expansion has re-rendered.
  const activeKeys = useMemo(
    () => grouped.groups.flatMap((g) => g.tasks).map(taskSelectionKey),
    [grouped],
  );
  const handledKeys = useMemo(
    () => grouped.handled.slice(0, handledVisible).map(taskSelectionKey),
    [grouped, handledVisible],
  );
  // The keyboard navigation domain in visual order: active tasks, plus the
  // visible handled tasks when the Handled archive is expanded, so arrowing
  // flows continuously from the active list into Handled and back.
  const visualKeys = useMemo(
    () => (handledExpanded ? [...activeKeys, ...handledKeys] : activeKeys),
    [activeKeys, handledKeys, handledExpanded],
  );
  const activeDescendantId = dominantSelectedKey
    ? rowDomId(dominantSelectedKey)
    : undefined;

  // Scroll the dominant selected row into view when the selection changes, or
  // when a reorder (kick/tackle/move up/down) shifts the still-selected task
  // (signalled by reorderTick). Deliberately NOT keyed on `tasks`: doing so
  // would also fire during the intermediate render of an advance action
  // (status/priority/due/dropkick), where tasks have already changed but the
  // selection hasn't advanced yet — scrolling to the stale, about-to-leave row
  // and causing a visible jump.
  useEffect(() => {
    if (!dominantSelectedKey) return;
    const row = rowRefs.current.get(dominantSelectedKey);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
  }, [dominantSelectedKey, reorderTick]);

  const registerRowRef = (selectionKey: string) => (node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(selectionKey, node);
    } else {
      rowRefs.current.delete(selectionKey);
    }
  };

  const handleTaskClick = (task: Task, e: React.MouseEvent) => {
    const clickedKey = taskSelectionKey(task);

    if (e.shiftKey) {
      // Range select over the same domain the keyboard uses (active tasks, plus
      // Handled when the archive is expanded), from the same anchor and by the
      // same rule — see planRangeSelection.
      const range = planRangeSelection(
        visualKeys,
        anchorRef.current,
        selectedKeys,
        clickedKey,
      );
      if (range) {
        setSelection(range);
        return;
      }
    }

    // Pointer chord: the command flags alone, no Alt exclusion — AltGr types
    // characters, which has no meaning for a click, and Cmd+Alt+Click must
    // keep toggling (keyboard-shortcut-conventions).
    if (hasPointerCommandModifier(e)) {
      // Toggle single.
      const next = new Set(selectedKeys);
      if (next.has(clickedKey)) {
        next.delete(clickedKey);
      } else {
        next.add(clickedKey);
      }
      anchorRef.current = clickedKey;
      setSelection(next);
      return;
    }

    // Simple click — select only this one.
    anchorRef.current = clickedKey;
    setSelection(new Set([clickedKey]));
  };

  const [editingTaskKey, setEditingTaskKey] = useState<string | null>(null);

  // Keyboard-first: focus the list on tab load so arrows work without a click,
  // but only when nothing else holds focus — never steal from an input or a tab
  // the user is already on.
  useEffect(() => {
    if (document.activeElement === document.body) {
      listRef.current?.focus();
    }
  }, []);

  const focusList = () => {
    requestAnimationFrame(() => listRef.current?.focus());
  };

  // Listbox navigation — active only while the list has focus. Command keys
  // (status/priority/due/dropkick/dismiss/reorder) are intentionally NOT handled
  // here: they fall through to the global command layer, which skips whatever
  // this handler consumes via preventDefault. Arrowing down past the last visible
  // item reaches into the Handled archive: it expands on first entry and loads the
  // next page as the cursor reaches the end, so Up/Down flow continuously through
  // active tasks and Handled without the disclosure or "show more" ever being a
  // focusable tab stop.
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || editingTaskKey !== null) return;
    // Cmd/Ctrl/Alt combos (reorder, tackle/kick, tab switch) are the global
    // command layer's; let them bubble untouched.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const len = visualKeys.length;
    const currentIdx = dominantSelectedKey
      ? visualKeys.indexOf(dominantSelectedKey)
      : -1;

    const selectKey = (key: string) => {
      anchorRef.current = key;
      setSelection(new Set([key]));
    };
    const selectIdx = (idx: number) => selectKey(visualKeys[idx]);
    const extendTo = (idx: number) => {
      let anchorIdx = anchorRef.current
        ? visualKeys.indexOf(anchorRef.current)
        : currentIdx;
      if (anchorIdx < 0) anchorIdx = idx;
      setSelection(new Set(rangeKeysBetween(visualKeys, anchorIdx, idx)));
    };
    // Execute an ArrowDown plan (move within the range, or cross the boundary
    // into the Handled archive). Shared by ArrowDown and the empty-list End case.
    const applyDownPlan = (plan: ListArrowDownPlan) => {
      switch (plan.kind) {
        case "select":
          if (e.shiftKey) extendTo(plan.index);
          else selectIdx(plan.index);
          break;
        case "expandHandled": {
          setHandledExpanded(viewKey, true);
          const first = grouped.handled[0];
          if (!first) break;
          const firstKey = taskSelectionKey(first);
          // Shift+Down across the boundary must extend the range into Handled,
          // not collapse the selection to one task. visualKeys hasn't picked up
          // the just-toggled expansion yet, so range over the explicit
          // post-expand domain.
          if (e.shiftKey) {
            const postExpand = [...activeKeys, ...handledKeys];
            const anchorIdx = anchorRef.current
              ? postExpand.indexOf(anchorRef.current)
              : -1;
            const targetIdx = postExpand.indexOf(firstKey);
            if (anchorIdx >= 0 && targetIdx >= 0) {
              setSelection(new Set(rangeKeysBetween(postExpand, anchorIdx, targetIdx)));
              break;
            }
          }
          selectKey(firstKey);
          break;
        }
        case "showMoreHandled":
          showMoreHandled(viewKey, pageSize);
          break;
        case "none":
          break;
      }
    };
    const downPlan = (cursor: number): ListArrowDownPlan =>
      planListArrowDown({
        currentIndex: cursor,
        length: len,
        handledExpanded,
        handledTotal: grouped.handledTotal,
        handledVisible,
      });

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        applyDownPlan(downPlan(currentIdx));
        return;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (len === 0) return;
        const target =
          currentIdx === -1 ? len - 1 : stepIndex(currentIdx, -1, len);
        if (e.shiftKey) extendTo(target);
        else selectIdx(target);
        return;
      }
      case "Home": {
        e.preventDefault();
        if (len === 0) return;
        if (e.shiftKey) extendTo(0);
        else selectIdx(0);
        return;
      }
      case "End": {
        e.preventDefault();
        if (len === 0) {
          applyDownPlan(downPlan(-1));
          return;
        }
        const last = len - 1;
        if (e.shiftKey) extendTo(last);
        else selectIdx(last);
        return;
      }
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        if (len === 0) return;
        const dir = e.key === "PageDown" ? 1 : -1;
        const target =
          currentIdx === -1
            ? dir === 1
              ? 0
              : len - 1
            : pageStepIndex(currentIdx, dir, LIST_PAGE, len);
        if (e.shiftKey) extendTo(target);
        else selectIdx(target);
        return;
      }
      default:
        return;
    }
  };

  if (!isUnifiedView && fileLoadError) {
    return (
      <LoadErrorPane
        filePath={filePath}
        message={describeLoadFailure("task list", fileLoadError)}
        onRetry={() => loadFile(filePath)}
        onRemove={() => closeTab(activeTabIndex)}
      />
    );
  }

  const handleRename = async (task: Task, newTitle: string) => {
    const cleaned = singleLine(newTitle, { minify: true });
    if (!cleaned) {
      // Don't allow empty titles — just cancel the rename.
      setEditingTaskKey(null);
      focusList();
      return;
    }
    if (cleaned !== task.title) {
      const result = await updateTitle(task.sourceFile, task.id, cleaned);
      if (result.status === "error") {
        await showMessage("Task Update Failed", result.message);
      }
    }
    setEditingTaskKey(null);
    focusList();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* New task button — fixed header; stays visible while the list scrolls. */}
      <button
        onClick={onNewTask}
        className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium text-primary hover:bg-primary-surface"
      >
        <Plus size={14} />
        New Task
        <span className="ml-auto text-primary">
          {`${primaryModifierLabel}+N`}
        </span>
      </button>

      {/* Unified view: warn about lists missing from the roll-up because their
          file failed to load, so an incomplete merge is never presented as the
          whole picture. Each affected list's own tab also shows a red icon and a
          retry pane when opened. */}
      {isUnifiedView && unifiedLoad.failedNames.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" />
          <span>
            {unifiedLoad.failedNames.length === 1
              ? `"${unifiedLoad.failedNames[0]}" could not be loaded and is not included here. Open its tab to retry.`
              : `${unifiedLoad.failedNames.length} lists could not be loaded and are not included here: ${unifiedLoad.failedNames.join(", ")}. Open the affected tabs to retry.`}
          </span>
        </div>
      )}

      {/* Unified view: a neutral notice while constituent lists are still
          loading, so the merge isn't briefly read as complete during the
          initial eager load. Disappears once every list is loaded or errored. */}
      {isUnifiedView && unifiedLoad.loadingCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-ink-muted">
          <span>
            Loading {unifiedLoad.loadingCount}{" "}
            {unifiedLoad.loadingCount === 1 ? "list" : "lists"}…
          </span>
        </div>
      )}

      {/* Scrollable region holding the one composite listbox. Group headers and
          the Handled disclosure stick to the top of this area as the list scrolls,
          just below the fixed New Task button. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-pt-[25px]">
        {/* The composite listbox: one tab stop spanning the active tasks and the
            Handled archive. Navigation is handled here and fires only while the
            list has focus. The Handled disclosure and "show more" are inside it as
            non-focusable click targets — never tab stops — and the keyboard reaches
            Handled by arrowing past the last active task (see handleListKeyDown).
            Flex-1 so the Handled archive's mt-auto sits at the bottom and the empty
            state centers. */}
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable={true}
          aria-label="Task list"
          aria-activedescendant={activeDescendantId}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="group flex flex-1 flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-ring"
        >
          {/* Hidden handled rows do not fill the mandatory list body. Keep its
              folded archive available below while saying the active list is empty. */}
          {emptyMessage && (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-muted">
              {emptyMessage}
            </div>
          )}

          {grouped.groups.map(({ group, label, tasks: groupTasks }) => (
            <div key={group}>
              <div
                className={`sticky top-0 z-10 border-b bg-surface-sunken/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur ${GROUP_COLORS[group]}`}
              >
                {label}
              </div>
              {groupTasks.map((task) => {
                const selectionKey = taskSelectionKey(task);
                return (
                  <TaskRow
                    key={selectionKey}
                    rowRef={registerRowRef(selectionKey)}
                    asOption
                    domId={rowDomId(selectionKey)}
                    task={task}
                    group={group}
                    isSelected={selectedKeys.has(selectionKey)}
                    isActive={selectionKey === dominantSelectedKey}
                    isEditing={editingTaskKey === selectionKey}
                    isUnifiedView={isUnifiedView}
                    sourceLabel={
                      isUnifiedView ? tabDisplayName(task.sourceFile, openTabs) : undefined
                    }
                    onClick={(e) => handleTaskClick(task, e)}
                    onDoubleClick={() => setEditingTaskKey(selectionKey)}
                    onRename={(title) => handleRename(task, title)}
                    onCancelRename={() => {
                      setEditingTaskKey(null);
                      focusList();
                    }}
                  />
                );
              })}
            </div>
          ))}

          {/* Handled archive — part of the listbox so arrow navigation flows into
              it. The disclosure and "show more" are non-focusable click targets
              (mouse toggles/loads; keyboard reaches Handled by arrowing in), so the
              listbox stays a single tab stop. */}
          {grouped.handledTotal > 0 && (
            <div className="mt-auto">
              <div
                onClick={() => setHandledExpanded(viewKey, !handledExpanded)}
                className="flex w-full cursor-pointer select-none items-center gap-2 border-y border-border bg-background px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-muted"
              >
                <span className="flex items-center">
                  {handledExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span>Handled ({grouped.handledTotal})</span>
              </div>

              {handledExpanded && (
                <>
                  {visibleHandled.map((task) => {
                    const selectionKey = taskSelectionKey(task);
                    return (
                      <TaskRow
                        key={selectionKey}
                        rowRef={registerRowRef(selectionKey)}
                        asOption
                        domId={rowDomId(selectionKey)}
                        task={task}
                        group="Default"
                        isSelected={selectedKeys.has(selectionKey)}
                        isActive={selectionKey === dominantSelectedKey}
                        isEditing={editingTaskKey === selectionKey}
                        isUnifiedView={isUnifiedView}
                        sourceLabel={
                          isUnifiedView ? tabDisplayName(task.sourceFile, openTabs) : undefined
                        }
                        onClick={(e) => handleTaskClick(task, e)}
                        onDoubleClick={() => setEditingTaskKey(selectionKey)}
                        onRename={(title) => handleRename(task, title)}
                        onCancelRename={() => {
                          setEditingTaskKey(null);
                          focusList();
                        }}
                      />
                    );
                  })}
                  {handledVisible < grouped.handledTotal && (
                    <div
                      onClick={() => showMoreHandled(viewKey, pageSize)}
                      className="w-full cursor-pointer select-none py-2 text-center text-xs text-primary hover:bg-primary-surface"
                    >
                      Show more ({grouped.handledTotal - handledVisible} remaining)
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Individual task row in the list.
function TaskRow({
  rowRef,
  asOption = false,
  domId,
  task,
  group,
  isSelected,
  isActive = false,
  isEditing,
  isUnifiedView,
  sourceLabel,
  onClick,
  onDoubleClick,
  onRename,
  onCancelRename,
}: {
  rowRef?: (node: HTMLDivElement | null) => void;
  // When true, the row is a listbox option. Both active rows and expanded
  // handled rows pass it: navigation runs continuously into the archive, and
  // aria-activedescendant points at handled rows once the cursor is inside it,
  // so they need the id/role/aria-selected this adds.
  asOption?: boolean;
  domId?: string;
  task: Task;
  group: TaskGroup;
  isSelected: boolean;
  isActive?: boolean;
  isEditing: boolean;
  isUnifiedView: boolean;
  // Resolved source-list label, shown in unified view. Computed by the parent
  // from the subscribed open tabs so a tab rename updates the row immediately.
  sourceLabel?: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(task.title);
  const composing = useComposing();

  // Reset draft and focus when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      setDraft(task.title);
      // Defer focus so the input is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing, task.title]);

  return (
    <div
      ref={rowRef}
      id={asOption ? domId : undefined}
      role={asOption ? "option" : undefined}
      aria-selected={asOption ? isSelected : undefined}
      onClick={isEditing ? undefined : onClick}
      onDoubleClick={isEditing ? undefined : onDoubleClick}
      className={`flex cursor-pointer items-center gap-2 border-b border-l-4 border-b-border-subtle px-3 py-2 transition-colors ${GROUP_BORDERS[group]} ${
        isSelected
          ? "bg-primary-surface-strong"
          : `${GROUP_BGS[group]} hover:bg-background`
      } ${
        asOption && isActive
          ? "group-focus-within:ring-1 group-focus-within:ring-inset group-focus-within:ring-primary-accent"
          : ""
      }`}
    >
      {/* Status indicator */}
      <span className="shrink-0 text-xs">
        {task.status === "Completed" && (
          <Check size={14} className="text-success" />
        )}
        {task.status === "Dismissed" && (
          <X size={14} className="text-ink-muted" />
        )}
      </span>

      {/* Title — editable on double-click */}
      {isEditing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              onRename(draft);
            }
            if (e.key === "Escape") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              onCancelRename();
            }
          }}
          {...composing.handlers}
          className="min-w-0 flex-1 rounded border border-primary-ring bg-surface px-1 py-0 text-sm outline-none"
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            task.status === "Dismissed" ? "line-through text-ink-muted" : ""
          } ${task.status === "Completed" ? "text-ink-soft" : ""}`}
        >
          {task.title || "Untitled"}
        </span>
      )}

      {/* Actionable notes indicator */}
      {task.hasActionableNotes && (
        <span title="Has actionable notes">
          <AlertCircle
            size={14}
            className="shrink-0 text-attention"
          />
        </span>
      )}

      {/* Source file label (unified view only) */}
      {isUnifiedView && (
        <span className="shrink-0 max-w-[30%] truncate text-xs text-ink-muted">
          {sourceLabel}
        </span>
      )}
    </div>
  );
}

function LoadErrorPane({
  filePath,
  message,
  onRetry,
  onRemove,
}: {
  filePath: string;
  message: string;
  onRetry: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-danger-border bg-danger-surface p-5 text-sm">
        <div className="mb-3 flex items-center gap-2 font-semibold text-danger-fg-strong">
          <AlertCircle size={16} />
          Task list could not be loaded
        </div>
        <p className="whitespace-pre-wrap text-danger-fg-strong">{message}</p>
        <p className="mt-3 truncate text-xs text-danger" title={filePath}>
          {filePath}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onRetry}
            className="rounded-md bg-danger-solid px-3 py-1.5 font-medium text-ink-inverted hover:bg-danger-solid-hover"
          >
            Retry
          </button>
          <button
            onClick={onRemove}
            className="rounded-md border border-danger-border-strong bg-surface px-3 py-1.5 font-medium text-danger hover:bg-danger-surface-strong"
          >
            Remove tab
          </button>
        </div>
      </div>
    </div>
  );
}


/** Look up the tab's display name for a file path; fall back to raw filename.
 * Pure over the passed-in tabs (subscribed by the caller), so a tab rename
 * re-renders the affected rows instead of reading a stale getState() snapshot. */
function tabDisplayName(
  path: string,
  openTabs: readonly { filePath: string; displayName: string }[],
): string {
  const tab = openTabs.find((t) => t.filePath === path);
  if (tab) return tab.displayName;
  return fileNameWithoutExt(path);
}
