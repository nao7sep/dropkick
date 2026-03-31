// Bulk actions — shown in right pane when 2+ tasks are selected.
// Supports status change, priority change, kick, and move to another list.

import { useState } from "react";
import type { Task, TaskStatus, TaskPriority } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";

interface BulkActionsProps {
  selectedTasks: Task[];
  filePath: string;
  isUnifiedView: boolean;
}

export function BulkActions({
  selectedTasks,
  filePath,
  isUnifiedView,
}: BulkActionsProps) {
  const kickDistances = usePreferencesStore((s) => s.preferences.kickDistances);
  const kick = useTaskListStore((s) => s.kick);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);
  const dropkick = useTaskListStore((s) => s.dropkick);
  const setStatus = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const moveTasks = useTaskListStore((s) => s.moveTasks);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [moveTarget, setMoveTarget] = useState("");

  const handleBulkStatus = async (status: TaskStatus) => {
    for (const task of selectedTasks) {
      const taskFile = isUnifiedView ? task.sourceFile : filePath;
      await setStatus(taskFile, task.id, status);
    }
  };

  const handleBulkPriority = async (priority: TaskPriority) => {
    for (const task of selectedTasks) {
      const taskFile = isUnifiedView ? task.sourceFile : filePath;
      await setPriority(taskFile, task.id, priority);
    }
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    if (isUnifiedView) {
      // Group tasks by source file and move each group.
      const bySource = new Map<string, Set<string>>();
      for (const task of selectedTasks) {
        const ids = bySource.get(task.sourceFile) ?? new Set();
        ids.add(task.id);
        bySource.set(task.sourceFile, ids);
      }
      for (const [src, ids] of bySource) {
        await moveTasks(src, moveTarget, ids);
      }
      // Re-select — tasks are still visible in unified view.
      setSelection(new Set(selectedTasks.map((t) => t.id)));
    } else {
      const ids = new Set(selectedTasks.map((t) => t.id));
      await moveTasks(filePath, moveTarget, ids);
    }
  };

  // Available move destinations (other open task list tabs).
  // In unified view, exclude any file that is a source for the selected tasks.
  const sourceFiles = isUnifiedView
    ? new Set(selectedTasks.map((t) => t.sourceFile))
    : new Set([filePath]);
  const moveDestinations = workspace.openTabs.filter(
    (t) => !t.isUnifiedView && !sourceFiles.has(t.filePath),
  );

  return (
    <div className="flex h-full flex-col p-6">
      <h3 className="mb-4 text-lg font-medium text-gray-700">
        {selectedTasks.length} tasks selected
      </h3>

      <div className="space-y-1 text-sm text-gray-500">
        {selectedTasks.map((t) => (
          <div key={t.id} className="truncate">
            • {t.title || "Untitled"}
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="mt-6">
        <label className="mb-2 block text-xs font-medium text-gray-500">
          Set Status
        </label>
        <div className="flex gap-2">
          {(["Pending", "Completed", "Dismissed"] as TaskStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => handleBulkStatus(s)}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="mt-4">
        <label className="mb-2 block text-xs font-medium text-gray-500">
          Set Priority
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => handleBulkPriority("Critical")}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Critical
          </button>
          <button
            onClick={() => handleBulkPriority("Urgent")}
            className="rounded-md border border-amber-200 px-3 py-1.5 text-sm text-amber-600 hover:bg-amber-50"
          >
            Urgent
          </button>
          <button
            onClick={() => handleBulkPriority("Important")}
            className="rounded-md border border-blue-200 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50"
          >
            Important
          </button>
          <button
            onClick={() => handleBulkPriority("Default")}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
          >
            Default
          </button>
        </div>
      </div>

      {/* Reorder (not in unified view) */}
      {!isUnifiedView && (
        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-gray-500">
            Reorder
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => sendToFirst(filePath)}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Tackle
            </button>
            {kickDistances.map((d) => (
              <button
                key={d}
                onClick={() => kick(filePath, d)}
                className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                +{d}
              </button>
            ))}
            <button
              onClick={() => sendToLast(filePath)}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Kick
            </button>
            <button
              onClick={() => dropkick(filePath)}
              className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
            >
              Dropkick
            </button>
          </div>
        </div>
      )}

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-gray-500">
            Move to
          </label>
          <div className="flex gap-2">
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
            >
              <option value="">Select destination...</option>
              {moveDestinations.map((t) => (
                <option key={t.filePath} value={t.filePath}>
                  {t.displayName}
                </option>
              ))}
            </select>
            <button
              onClick={handleMove}
              disabled={!moveTarget}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              Move
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
