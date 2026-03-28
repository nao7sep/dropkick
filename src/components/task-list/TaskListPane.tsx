// Left pane — displays tasks grouped by priority/due rules.
// Supports selection (click, shift+click, cmd+click).

import { useState, useMemo } from "react";
import { AlertCircle } from "lucide-react";
import type { Task, TaskGroup } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { toTask } from "../../utils";
import {
  groupTasksForList,
  groupTasksForUnifiedView,
} from "../../services";

interface TaskListPaneProps {
  filePath: string;
  isUnifiedView: boolean;
}

const GROUP_COLORS: Record<TaskGroup, string> = {
  PastDue: "text-red-600 border-red-200",
  Critical: "text-red-600 border-red-200",
  DueWithinWeek: "text-amber-600 border-amber-200",
  Urgent: "text-amber-600 border-amber-200",
  Important: "text-blue-600 border-blue-200",
  Default: "text-gray-500 border-gray-200",
};

const PRIORITY_BORDERS: Record<string, string> = {
  Critical: "border-l-red-500",
  Urgent: "border-l-amber-400",
  Important: "border-l-blue-400",
  Default: "border-l-transparent",
};

const PRIORITY_BGS: Record<string, string> = {
  Critical: "bg-red-50/50",
  Urgent: "bg-amber-50/50",
  Important: "bg-blue-50/50",
  Default: "",
};

export function TaskListPane({ filePath, isUnifiedView }: TaskListPaneProps) {
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const pageSize = usePreferencesStore((s) => s.preferences.handledTasksPageSize);
  const selectedIds = useTaskListStore((s) => s.selectedIds);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const showMoreHandled = useTaskListStore((s) => s.showMoreHandled);
  const handledVisible = useTaskListStore(
    (s) => s.handledVisible[filePath] ?? pageSize,
  );

  // Select raw data from store (stable references), compute domain models in useMemo.
  const files = useTaskListStore((s) => s.files);

  const tasks = useMemo(() => {
    if (isUnifiedView) {
      const allTasks: Task[] = [];
      for (const [fp, fileState] of Object.entries(files)) {
        for (const dto of fileState.data.tasks) {
          allTasks.push(toTask(dto, fp, timezone));
        }
      }
      return allTasks;
    }
    const fileState = files[filePath];
    if (!fileState) return [] as Task[];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone));
  }, [files, filePath, isUnifiedView, timezone]);

  const grouped = useMemo(
    () =>
      isUnifiedView
        ? groupTasksForUnifiedView(tasks)
        : groupTasksForList(tasks),
    [tasks, isUnifiedView],
  );

  const handleTaskClick = (task: Task, e: React.MouseEvent) => {
    if (e.shiftKey && selectedIds.size > 0) {
      // Range select: find all tasks between last selected and clicked.
      const allActive = grouped.groups.flatMap((g) => g.tasks);
      const lastSelectedId = [...selectedIds].pop()!;
      const lastIdx = allActive.findIndex((t) => t.id === lastSelectedId);
      const clickIdx = allActive.findIndex((t) => t.id === task.id);
      if (lastIdx !== -1 && clickIdx !== -1) {
        const [start, end] = [
          Math.min(lastIdx, clickIdx),
          Math.max(lastIdx, clickIdx),
        ];
        const rangeIds = allActive.slice(start, end + 1).map((t) => t.id);
        setSelection(new Set([...selectedIds, ...rangeIds]));
        return;
      }
    }

    if (e.metaKey || e.ctrlKey) {
      // Toggle single.
      const next = new Set(selectedIds);
      if (next.has(task.id)) {
        next.delete(task.id);
      } else {
        next.add(task.id);
      }
      setSelection(next);
      return;
    }

    // Simple click — select only this one.
    setSelection(new Set([task.id]));
  };

  const [handledExpanded, setHandledExpanded] = useState(false);

  const visibleHandled = grouped.handled.slice(0, handledVisible);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Active task groups */}
      {grouped.groups.length === 0 && grouped.handledTotal === 0 && (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-gray-400">
          No tasks yet. Press Ctrl+N to create one.
        </div>
      )}

      {grouped.groups.map(({ group, label, tasks: groupTasks }) => (
        <div key={group}>
          <div
            className={`sticky top-0 z-10 border-b bg-gray-50/90 px-3 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur ${GROUP_COLORS[group]}`}
          >
            {label}
          </div>
          {groupTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={selectedIds.has(task.id)}
              isUnifiedView={isUnifiedView}
              onClick={(e) => handleTaskClick(task, e)}
            />
          ))}
        </div>
      ))}

      {/* Handled section */}
      {grouped.handledTotal > 0 && (
        <div className="mt-auto">
          <button
            onClick={() => setHandledExpanded(!handledExpanded)}
            className="flex w-full items-center gap-2 border-y border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            <span>{handledExpanded ? "▾" : "▸"}</span>
            <span>Handled ({grouped.handledTotal})</span>
          </button>

          {handledExpanded && (
            <>
              {visibleHandled.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedIds.has(task.id)}
                  isUnifiedView={isUnifiedView}
                  onClick={(e) => handleTaskClick(task, e)}
                />
              ))}
              {handledVisible < grouped.handledTotal && (
                <button
                  onClick={() => showMoreHandled(filePath, pageSize)}
                  className="w-full py-2 text-center text-xs text-blue-500 hover:bg-blue-50"
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
  task,
  isSelected,
  isUnifiedView,
  onClick,
}: {
  task: Task;
  isSelected: boolean;
  isUnifiedView: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const isHandled = task.status !== "Pending";

  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 border-b border-l-4 border-b-gray-100 px-3 py-2 transition-colors ${PRIORITY_BORDERS[task.priority] ?? ""} ${
        isSelected
          ? "bg-blue-100"
          : `${PRIORITY_BGS[task.priority] ?? ""} hover:bg-gray-50`
      } ${isHandled ? "opacity-60" : ""}`}
    >
      {/* Status indicator */}
      <span className="shrink-0 text-xs">
        {task.status === "Completed" && (
          <span className="text-green-500">✓</span>
        )}
        {task.status === "Dismissed" && (
          <span className="text-gray-400">✗</span>
        )}
      </span>

      {/* Title */}
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          task.status === "Dismissed" ? "line-through text-gray-400" : ""
        } ${task.status === "Completed" ? "text-gray-500" : ""}`}
      >
        {task.title || "Untitled"}
      </span>

      {/* Actionable notes indicator */}
      {task.hasActionableNotes && (
        <span title="Has actionable notes">
          <AlertCircle
            size={14}
            className="shrink-0 text-orange-500"
          />
        </span>
      )}

      {/* Source file label (unified view only) */}
      {isUnifiedView && (
        <span className="shrink-0 max-w-20 truncate text-xs text-gray-400">
          {fileNameFromPath(task.sourceFile)}
        </span>
      )}
    </div>
  );
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
}

