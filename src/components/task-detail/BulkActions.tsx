// Bulk actions — shown in right pane when 2+ tasks are selected.
// Supports status change, priority change, kick, and move to another list.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Task, TaskStatus, TaskPriority } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";
import type { ActionResult } from "../../state";
import {
  statusAdvancesSelection,
  taskSelectionKey,
} from "../../utils";
import {
  collectTaskActionFailures,
  describeTaskActionFailures,
  moveSelectedTasks,
} from "../../services";
import { Toolbar } from "../shared/Toolbar";
import { SelectedTaskTitleList } from "../shared/SelectedTaskTitleList";
import { useTaskDeletion } from "../../hooks/useTaskDeletion";
import { InlineResult } from "../shared/InlineResult";

interface PaneIssue {
  title: string;
  message: string;
}

interface BulkActionsProps {
  selectedTasks: Task[];
  filePath: string;
  isUnifiedView: boolean;
  nextActiveTaskKey: string | null;
  externalIssue?: PaneIssue | null;
  onDismissExternalIssue?: () => void;
  onReportExternalIssue?: (
    ownerKeys: readonly string[],
    title: string,
    message: string,
  ) => void;
}

export function BulkActions({
  selectedTasks,
  filePath,
  isUnifiedView,
  nextActiveTaskKey,
  externalIssue,
  onDismissExternalIssue,
  onReportExternalIssue,
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
  const [actionErrors, setActionErrors] = useState<
    Record<string, PaneIssue>
  >({});
  const deleteTasks = useTaskDeletion();

  const reportActionError = (operation: string, title: string, message: string) => {
    setActionErrors((errors) => ({ ...errors, [operation]: { title, message } }));
  };

  const clearActionError = (operation: string) => {
    setActionErrors((errors) => {
      if (!(operation in errors)) return errors;
      const { [operation]: _removed, ...rest } = errors;
      return rest;
    });
  };

  const handleActionResult = (
    operation: string,
    title: string,
    result: ActionResult,
  ) => {
    if (result.status === "error") {
      reportActionError(operation, title, result.message);
      return true;
    }
    clearActionError(operation);
    return false;
  };

  const handleBulkStatus = async (status: TaskStatus) => {
    const results: ActionResult[] = [];
    for (const task of selectedTasks) {
      results.push(await setStatus(task.sourceFile, task.id, status));
    }
    const failures = collectTaskActionFailures(selectedTasks, results);
    if (failures.length > 0) {
      reportActionError(
        "status",
        "Some tasks were not updated",
        describeTaskActionFailures(failures),
      );
    } else {
      clearActionError("status");
    }

    // Same pointer rule as the detail pane, plus: a partially applied bulk
    // change keeps the selection so the user can see what was skipped.
    if (failures.length === 0 && statusAdvancesSelection(status)) {
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
  };

  const handleBulkPriority = async (priority: TaskPriority) => {
    const results: ActionResult[] = [];
    for (const task of selectedTasks) {
      results.push(await setPriority(task.sourceFile, task.id, priority));
    }
    const failures = collectTaskActionFailures(selectedTasks, results);
    if (failures.length > 0) {
      reportActionError(
        "priority",
        "Some tasks were not updated",
        describeTaskActionFailures(failures),
      );
    } else {
      clearActionError("priority");
    }
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    const outcome = await moveSelectedTasks({
      selectedTasks,
      destination: moveTarget,
      isUnifiedView,
      sourceFilePath: filePath,
      nextActiveTaskKey,
      moveTasks,
    });
    setSelection(outcome.selection);
    if (outcome.status === "error") {
      if (onReportExternalIssue) {
        onReportExternalIssue(
          [...outcome.selection],
          "Some tasks could not be moved",
          outcome.message!,
        );
      } else {
        reportActionError("move", "Some tasks could not be moved", outcome.message!);
      }
      return;
    }
    clearActionError("move");
    setMoveTarget("");
  };

  const handleDelete = async () => {
    const result = await deleteTasks(selectedTasks, nextActiveTaskKey);
    if (!result || result.failedTasks.length === 0) {
      clearActionError("delete");
      return;
    }
    const title =
      result.deletedTasks.length > 0
        ? "Some tasks were not deleted"
        : "Tasks could not be deleted";
    const message = result.failures
      .map(({ task, reason }) => `${task.title || "Untitled"}: ${reason}`)
      .join("\n");
    if (onReportExternalIssue) {
      onReportExternalIssue(result.failedTasks.map(taskSelectionKey), title, message);
    } else {
      reportActionError("delete", title, message);
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
      {externalIssue ? (
        <InlineResult
          title={externalIssue.title}
          message={externalIssue.message}
          onDismiss={onDismissExternalIssue}
          className="mb-3 shrink-0"
        />
      ) : null}
      {Object.entries(actionErrors).map(([operation, issue]) => (
        <InlineResult
          key={operation}
          title={issue.title}
          message={issue.message}
          onDismiss={() => clearActionError(operation)}
          className="mb-3 shrink-0"
        />
      ))}
      <h3 className="mb-4 text-lg font-medium text-ink">
        {selectedTasks.length} tasks selected
      </h3>

      <SelectedTaskTitleList tasks={selectedTasks} />

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
          <Toolbar label="Reorder selected tasks" className="flex gap-2">
            <button
              onClick={async () => {
                const result = await sendToFirst(filePath);
                handleActionResult("reorder", "Tasks could not be reordered", result);
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
                  handleActionResult("reorder", "Tasks could not be reordered", result);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
              >
                +{d}
              </button>
            ))}
            <button
              onClick={async () => {
                const result = await sendToLast(filePath);
                handleActionResult("reorder", "Tasks could not be reordered", result);
              }}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-soft hover:bg-background"
            >
              Kick
            </button>
            <button
              onClick={async () => {
                const result = await dropkick(filePath);
                handleActionResult("reorder", "Tasks could not be reordered", result);
              }}
              className="rounded-md border border-danger-border px-3 py-1.5 text-sm text-danger hover:bg-danger-surface"
            >
              Dropkick
            </button>
          </Toolbar>
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

      <div className="mt-6 border-t border-border pt-4">
        <button
          onClick={() => void handleDelete()}
          className="flex items-center gap-1 rounded-md border border-danger-border px-3 py-1.5 text-sm text-danger hover:bg-danger-surface"
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </div>
  );
}
