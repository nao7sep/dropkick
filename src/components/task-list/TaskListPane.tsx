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
  PastDue: "text-red-700 border-red-200",
  Critical: "text-violet-700 border-violet-200",
  DueToday: "text-orange-700 border-orange-200",
  Important: "text-blue-700 border-blue-200",
  Urgent: "text-rose-700 border-rose-200",
  DueSoon: "text-teal-700 border-teal-200",
  Default: "text-gray-600 border-gray-200",
};

const GROUP_BORDERS: Record<TaskGroup, string> = {
  PastDue: "border-l-red-500",
  Critical: "border-l-violet-500",
  DueToday: "border-l-orange-500",
  Important: "border-l-blue-500",
  Urgent: "border-l-rose-500",
  DueSoon: "border-l-teal-500",
  Default: "border-l-transparent",
};

const GROUP_BGS: Record<TaskGroup, string> = {
  PastDue: "bg-red-50/60",
  Critical: "bg-violet-50/60",
  DueToday: "bg-orange-50/60",
  Important: "bg-blue-50/60",
  Urgent: "bg-rose-50/60",
  DueSoon: "bg-teal-50/60",
  Default: "",
};

export function TaskListPane({ filePath, isUnifiedView, onNewTask }: TaskListPaneProps) {
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const dueSoonDays = usePreferencesStore((s) => s.preferences.dueSoonDays);
  const pageSize = usePreferencesStore((s) => s.preferences.handledTasksPageSize);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const showMoreHandled = useTaskListStore((s) => s.showMoreHandled);
  const setHandledExpanded = useTaskListStore((s) => s.setHandledExpanded);
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

  useEffect(() => {
    if (!dominantSelectedKey) return;
    const row = rowRefs.current.get(dominantSelectedKey);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
  }, [dominantSelectedKey, tasks]);

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
    <div className="flex flex-1 flex-col overflow-y-auto scroll-pt-[25px]">
      {/* New task button */}
      <button
        onClick={onNewTask}
        className="flex w-full items-center gap-1.5 border-b border-gray-200 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50"
      >
        <Plus size={14} />
        New Task
        <span className="ml-auto text-sky-700">
          Cmd+N
        </span>
      </button>

      {/* Active task groups */}
      {grouped.groups.length === 0 && grouped.handledTotal === 0 && (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-500">
          No tasks yet.
        </div>
      )}

      {grouped.groups.map(({ group, label, tasks: groupTasks }) => (
        <div key={group}>
          <div
            className={`sticky top-0 z-10 border-b bg-gray-50/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur ${GROUP_COLORS[group]}`}
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
            className="flex w-full items-center gap-2 border-y border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
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
                  className="w-full py-2 text-center text-xs text-sky-700 hover:bg-sky-50"
                >
                  Show more ({grouped.handledTotal - handledVisible} remaining)
                </button>
              )}
            </>
          )}
        </div>
      )}
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
      className={`flex cursor-pointer items-center gap-2 border-b border-l-4 border-b-gray-100 px-3 py-2 transition-colors ${GROUP_BORDERS[group]} ${
        isSelected
          ? "bg-sky-100"
          : `${GROUP_BGS[group]} hover:bg-gray-50`
      }`}
    >
      {/* Status indicator */}
      <span className="shrink-0 text-xs">
        {task.status === "Completed" && (
          <span className="text-green-700">✓</span>
        )}
        {task.status === "Dismissed" && (
          <span className="text-gray-500">✗</span>
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
          className="min-w-0 flex-1 rounded border border-sky-400 bg-white px-1 py-0 text-sm outline-none"
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            task.status === "Dismissed" ? "line-through text-gray-500" : ""
          } ${task.status === "Completed" ? "text-gray-600" : ""}`}
        >
          {task.title || "Untitled"}
        </span>
      )}

      {/* Actionable notes indicator */}
      {task.hasActionableNotes && (
        <span title="Has actionable notes">
          <AlertCircle
            size={14}
            className="shrink-0 text-orange-700"
          />
        </span>
      )}

      {/* Source file label (unified view only) */}
      {isUnifiedView && (
        <span className="shrink-0 max-w-[30%] truncate text-xs text-gray-500">
          {tabDisplayName(task.sourceFile)}
        </span>
      )}
    </div>
  );
}

/** Look up the tab's display name for a file path; fall back to raw filename. */
function tabDisplayName(path: string): string {
  const tabs = useWorkspaceStore.getState().workspace.openTabs;
  const tab = tabs.find((t) => t.filePath === path);
  if (tab) return tab.displayName;
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
}
