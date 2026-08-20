// Bulk actions — shown in right pane when 2+ tasks are selected.
// Supports status change, priority change, kick, and move to another list.

import { useState } from "react";
import type { Task, TaskStatus, TaskPriority } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { showMessage } from "../../repositories";
import type { ActionResult } from "../../state";
import { groupMoveBySource, summarizeBulkStatusResult } from "../../utils";
import { taskKey, taskSelectionKey } from "../../utils";

interface BulkActionsProps {
  selectedTasks: Task[];
  filePath: string;
  isUnifiedView: boolean;
  nextActiveTaskKey: string | null;
}

export function BulkActions({
  selectedTasks,
  filePath,
  isUnifiedView,
  nextActiveTaskKey,
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

  const showWriteFailure = async (title: string, result: ActionResult) => {
    if (result.status === "error") {
      await showMessage(title, result.message);
      return true;
    }
    return false;
  };

  const handleBulkStatus = async (status: TaskStatus) => {
    const results: ActionResult[] = [];
    for (const task of selectedTasks) {
      results.push(await setStatus(task.sourceFile, task.id, status));
    }
    const summary = summarizeBulkStatusResult(results);

    if (summary.hasIssues) {
      const details: string[] = [];
      if (summary.skippedCount > 0) {
        details.push(`Skipped ${summary.skippedCount} task(s): ${summary.reasonsText}.`);
      }
      if (summary.firstError !== null) {
        details.push(`First error: ${summary.firstError}`);
      }
      await showMessage("Some Tasks Were Not Updated", details.join("\n\n"));
    }

    if (
      !summary.hasIssues &&
      (status === "Completed" || status === "Dismissed")
    ) {
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
  };

  const handleBulkPriority = async (priority: TaskPriority) => {
    let firstError: string | null = null;
    for (const task of selectedTasks) {
      const result = await setPriority(task.sourceFile, task.id, priority);
      if (result.status === "error" && firstError === null) {
        firstError = result.message;
      }
    }

    if (firstError !== null) {
      await showMessage("Task Update Failed", firstError);
    }
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    if (isUnifiedView) {
      // Group tasks by source file and move each group.
      const bySource = groupMoveBySource(selectedTasks);
      let movedAny = false;
      const movedSources = new Set<string>();
      for (const [src, ids] of bySource) {
        const result = await moveTasks(src, moveTarget, ids);
        if (result.status === "error") {
          const message = movedAny
            ? `Some selected tasks were moved before the operation stopped.\n\n${result.message}`
            : result.message;
          setSelection(
            new Set(
              selectedTasks.map((t) =>
                movedSources.has(t.sourceFile)
                  ? taskKey(moveTarget, t.id)
                  : taskSelectionKey(t),
              ),
            ),
          );
          await showMessage("Move Failed", message);
          return;
        }
        movedAny = true;
        movedSources.add(src);
      }
      // Re-select — tasks are still visible in unified view.
      setSelection(new Set(selectedTasks.map((t) => taskKey(moveTarget, t.id))));
      setMoveTarget("");
    } else {
      const ids = new Set(selectedTasks.map((t) => t.id));
      const result = await moveTasks(filePath, moveTarget, ids);
      if (result.status === "error") {
        await showMessage("Move Failed", result.message);
        return;
      }
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
      setMoveTarget("");
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
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <h3 className="mb-4 text-lg font-medium text-ink">
        {selectedTasks.length} tasks selected
      </h3>

      <div className="space-y-1 text-sm text-ink-muted">
        {selectedTasks.map((t) => (
          <div key={taskSelectionKey(t)} className="truncate">
            • {t.title || "Untitled"}
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="mt-6">
        <label className="mb-2 block text-xs font-medium text-ink-muted">
          Set Status
        </label>
        <div className="flex gap-2">
          {(["Pending", "Completed", "Dismissed"] as TaskStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => handleBulkStatus(s)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="mt-4">
        <label className="mb-2 block text-xs font-medium text-ink-muted">
          Set Priority
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => handleBulkPriority("Critical")}
            className="rounded-md border border-group-critical-border px-3 py-1.5 text-sm text-group-critical-fg hover:bg-group-critical-tint"
          >
            Critical
          </button>
          <button
            onClick={() => handleBulkPriority("Important")}
            className="rounded-md border border-group-important-border px-3 py-1.5 text-sm text-group-important-fg hover:bg-group-important-tint"
          >
            Important
          </button>
          <button
            onClick={() => handleBulkPriority("Urgent")}
            className="rounded-md border border-group-urgent-border px-3 py-1.5 text-sm text-group-urgent-fg hover:bg-group-urgent-tint"
          >
            Urgent
          </button>
          <button
            onClick={() => handleBulkPriority("Default")}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-muted hover:bg-background"
          >
            Default
          </button>
        </div>
      </div>

      {/* Reorder (not in unified view) */}
      {!isUnifiedView && (
        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-ink-muted">
            Reorder
          </label>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const result = await sendToFirst(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
            >
              Tackle
            </button>
            {kickDistances.map((d) => (
              <button
                key={d}
                onClick={async () => {
                  const result = await kick(filePath, d);
                  await showWriteFailure("Task Reorder Failed", result);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
              >
                +{d}
              </button>
            ))}
            <button
              onClick={async () => {
                const result = await sendToLast(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
            >
              Kick
            </button>
            <button
              onClick={async () => {
                const result = await dropkick(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded-md border border-danger-border px-3 py-1.5 text-sm text-danger hover:bg-danger-surface"
            >
              Dropkick
            </button>
          </div>
        </div>
      )}

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mt-4">
          <label className="mb-2 block text-xs font-medium text-ink-muted">
            Move to
          </label>
          <div className="flex gap-2">
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-sm text-ink-soft"
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
              className="rounded-md bg-primary-solid px-4 py-1.5 text-sm text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
            >
              Move
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
