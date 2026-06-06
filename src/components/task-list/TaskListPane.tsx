// Left pane — displays tasks grouped by priority/due rules.
// Supports selection (click, Shift+click, Cmd+click on macOS / Ctrl+click on Windows).

import { useState, useRef, useMemo, useEffect } from "react";
import { Plus, AlertCircle } from "lucide-react";
import type { Task, TaskGroup } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { showMessage } from "../../repositories";
import {
  toTask,
  sanitizeSingleLine,
  hasPrimaryShortcutModifier,
  primaryModifierLabel,
  taskSelectionKey,
} from "../../utils";
import {
  groupTasksForList,
  groupTasksForUnifiedView,
} from "../../services";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";

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
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const dueSoonDays = usePreferencesStore((s) => s.preferences.dueSoonDays);
  const pageSize = usePreferencesStore((s) => s.preferences.handledTasksPageSize);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const reorderTick = useTaskListStore((s) => s.reorderTick);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const showMoreHandled = useTaskListStore((s) => s.showMoreHandled);
  const setHandledExpanded = useTaskListStore((s) => s.setHandledExpanded);
  const fileLoadError = useTaskListStore((s) => s.fileLoadErrors[filePath]);
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

  // Select raw data from store (stable references), compute domain models in useMemo.
  const files = useTaskListStore((s) => s.files);
  const openTabs = useWorkspaceStore((s) => s.workspace.openTabs);

  const tasks = useMemo(() => {
    if (isUnifiedView) {
      const allTasks: Task[] = [];
      for (const tab of openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          allTasks.push(toTask(dto, tab.filePath, timezone, dueSoonDays));
        }
      }
      return allTasks;
    }
    const fileState = files[filePath];
    if (!fileState) return [] as Task[];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone, dueSoonDays));
  }, [files, filePath, isUnifiedView, timezone, dueSoonDays, openTabs]);

  const grouped = useMemo(
    () =>
      isUnifiedView
        ? groupTasksForUnifiedView(tasks)
        : groupTasksForList(tasks),
    [tasks, isUnifiedView],
  );
  const visibleHandled = grouped.handled.slice(0, handledVisible);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const dominantSelectedKey = useMemo(() => {
    const keys = [...selectedKeys];
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }, [selectedKeys]);

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

    if (e.shiftKey && selectedKeys.size > 0) {
      // Range select: find all tasks between last selected and clicked.
      const allActive = grouped.groups.flatMap((g) => g.tasks);
      const lastSelectedKey = [...selectedKeys].pop()!;
      const lastIdx = allActive.findIndex(
        (t) => taskSelectionKey(t) === lastSelectedKey,
      );
      const clickIdx = allActive.findIndex((t) => taskSelectionKey(t) === clickedKey);
      if (lastIdx !== -1 && clickIdx !== -1) {
        const [start, end] = [
          Math.min(lastIdx, clickIdx),
          Math.max(lastIdx, clickIdx),
        ];
        const rangeKeys = allActive
          .slice(start, end + 1)
          .map((t) => taskSelectionKey(t));
        setSelection(new Set([...selectedKeys, ...rangeKeys]));
        return;
      }
    }

    if (hasPrimaryShortcutModifier(e)) {
      // Toggle single.
      const next = new Set(selectedKeys);
      if (next.has(clickedKey)) {
        next.delete(clickedKey);
      } else {
        next.add(clickedKey);
      }
      setSelection(next);
      return;
    }

    // Simple click — select only this one.
    setSelection(new Set([clickedKey]));
  };

  const [editingTaskKey, setEditingTaskKey] = useState<string | null>(null);

  if (!isUnifiedView && fileLoadError) {
    return (
      <LoadErrorPane
        filePath={filePath}
        message={loadErrorMessage(fileLoadError)}
        onRetry={() => loadFile(filePath)}
        onRemove={() => closeTab(activeTabIndex)}
      />
    );
  }

  const handleRename = async (task: Task, newTitle: string) => {
    const cleaned = sanitizeSingleLine(newTitle);
    if (!cleaned) {
      // Don't allow empty titles — just cancel the rename.
      setEditingTaskKey(null);
      return;
    }
    if (cleaned !== task.title) {
      const taskFile = isUnifiedView ? task.sourceFile : filePath;
      const result = await updateTitle(taskFile, task.id, cleaned);
      if (result.status === "error") {
        await showMessage("Task Update Failed", result.message);
      }
    }
    setEditingTaskKey(null);
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

      {/* Scrollable list — group headers stick to the top of this area, just
          below the fixed New Task button. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-pt-[25px]">
        {/* Active task groups */}
        {grouped.groups.length === 0 && grouped.handledTotal === 0 && (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-muted">
            No tasks yet.
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
                  task={task}
                  group={group}
                  isSelected={selectedKeys.has(selectionKey)}
                  isEditing={editingTaskKey === selectionKey}
                  isUnifiedView={isUnifiedView}
                  onClick={(e) => handleTaskClick(task, e)}
                  onDoubleClick={() => setEditingTaskKey(selectionKey)}
                  onRename={(title) => handleRename(task, title)}
                  onCancelRename={() => setEditingTaskKey(null)}
                />
              );
            })}
          </div>
        ))}

        {/* Handled section */}
        {grouped.handledTotal > 0 && (
          <div className="mt-auto">
            <button
              onClick={() => setHandledExpanded(viewKey, !handledExpanded)}
              className="flex w-full items-center gap-2 border-y border-border bg-background px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-muted"
            >
              <span>{handledExpanded ? "▾" : "▸"}</span>
              <span>Handled ({grouped.handledTotal})</span>
            </button>

            {handledExpanded && (
              <>
                {visibleHandled.map((task) => {
                  const selectionKey = taskSelectionKey(task);
                  return (
                    <TaskRow
                      key={selectionKey}
                      rowRef={registerRowRef(selectionKey)}
                      task={task}
                      group="Default"
                      isSelected={selectedKeys.has(selectionKey)}
                      isEditing={editingTaskKey === selectionKey}
                      isUnifiedView={isUnifiedView}
                      onClick={(e) => handleTaskClick(task, e)}
                      onDoubleClick={() => setEditingTaskKey(selectionKey)}
                      onRename={(title) => handleRename(task, title)}
                      onCancelRename={() => setEditingTaskKey(null)}
                    />
                  );
                })}
                {handledVisible < grouped.handledTotal && (
                  <button
                    onClick={() => showMoreHandled(viewKey, pageSize)}
                    className="w-full py-2 text-center text-xs text-primary hover:bg-primary-surface"
                  >
                    Show more ({grouped.handledTotal - handledVisible} remaining)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Individual task row in the list.
function TaskRow({
  rowRef,
  task,
  group,
  isSelected,
  isEditing,
  isUnifiedView,
  onClick,
  onDoubleClick,
  onRename,
  onCancelRename,
}: {
  rowRef?: (node: HTMLDivElement | null) => void;
  task: Task;
  group: TaskGroup;
  isSelected: boolean;
  isEditing: boolean;
  isUnifiedView: boolean;
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
      onClick={isEditing ? undefined : onClick}
      onDoubleClick={isEditing ? undefined : onDoubleClick}
      className={`flex cursor-pointer items-center gap-2 border-b border-l-4 border-b-border-subtle px-3 py-2 transition-colors ${GROUP_BORDERS[group]} ${
        isSelected
          ? "bg-primary-surface-strong"
          : `${GROUP_BGS[group]} hover:bg-background`
      }`}
    >
      {/* Status indicator */}
      <span className="shrink-0 text-xs">
        {task.status === "Completed" && (
          <span className="text-success">✓</span>
        )}
        {task.status === "Dismissed" && (
          <span className="text-ink-muted">✗</span>
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
          {tabDisplayName(task.sourceFile)}
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

function loadErrorMessage(
  error:
    | { status: "missing" }
    | { status: "invalid"; message: string }
    | { status: "error"; message: string },
): string {
  if (error.status === "missing") {
    return "The task list file could not be found.";
  }
  return `The task list file could not be loaded:\n\n${error.message}`;
}

/** Look up the tab's display name for a file path; fall back to raw filename. */
function tabDisplayName(path: string): string {
  const tabs = useWorkspaceStore.getState().workspace.openTabs;
  const tab = tabs.find((t) => t.filePath === path);
  if (tab) return tab.displayName;
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
}
