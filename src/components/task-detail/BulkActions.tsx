// Bulk actions — shown in right pane when 2+ tasks are selected.
// Supports status change, priority change, kick, and move to another list.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Task, TaskStatus, TaskPriority } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { notSaved, type ActionResult } from "../../state";
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
import { Button } from "../shared/Button";
import { SelectedTaskTitleList } from "../shared/SelectedTaskTitleList";
import { useTaskDeletion } from "../../hooks/useTaskDeletion";
import { InlineResult } from "../shared/InlineResult";
import { useI18n } from "../../i18n/I18nContext";
import { PRIORITY_LABELS, STATUS_LABELS } from "../../i18n/domainLabels";
import { message, type Message } from "../../i18n/translate";

interface PaneIssue {
  title: Message;
  message: Message;
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
    title: Message,
    message: Message,
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
  const { t } = useI18n();
  const kickDistances = usePreferencesStore((s) => s.preferences.kickDistances);
  const kick = useTaskListStore((s) => s.kick);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);
  const moveUp = useTaskListStore((s) => s.moveUp);
  const moveDown = useTaskListStore((s) => s.moveDown);
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

  const reportActionError = (operation: string, title: Message, reason: Message) => {
    setActionErrors((errors) => ({ ...errors, [operation]: { title, message: reason } }));
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
    title: Message,
    result: ActionResult,
  ) => {
    if (notSaved(result)) {
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
        message("bulk.notUpdated"),
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
        message("bulk.notUpdated"),
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
          message("bulk.notMoved"),
          outcome.message!,
        );
      } else {
        reportActionError("move", message("bulk.notMoved"), outcome.message!);
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
    const title = message(
      result.deletedTasks.length > 0 ? "bulk.someNotDeleted" : "bulk.noneDeleted",
    );
    const reasons = describeTaskActionFailures(result.failures);
    if (onReportExternalIssue) {
      onReportExternalIssue(result.failedTasks.map(taskSelectionKey), title, reasons);
    } else {
      reportActionError("delete", title, reasons);
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
      <h3 className="mb-4 text-lg font-semibold text-ink-strong">
        {t("bulk.selected", { count: selectedTasks.length })}
      </h3>

      <SelectedTaskTitleList tasks={selectedTasks} />

      {/* Status */}
      <div className="mt-6">
        <label className="dk-label">
          {t("bulk.setStatus")}
        </label>
        <div className="flex flex-wrap gap-2">
          {(["Pending", "Completed", "Dismissed"] as TaskStatus[]).map((s) => (
            <Button key={s} onClick={() => handleBulkStatus(s)}>
              {t(STATUS_LABELS[s])}
            </Button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="mt-4">
        <label className="dk-label">
          {t("bulk.setPriority")}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleBulkPriority("Critical")}
            className="dk-btn dk-btn-tint dk-tint-critical"
          >
            {t(PRIORITY_LABELS.Critical)}
          </button>
          <button
            type="button"
            onClick={() => handleBulkPriority("Important")}
            className="dk-btn dk-btn-tint dk-tint-important"
          >
            {t(PRIORITY_LABELS.Important)}
          </button>
          <button
            type="button"
            onClick={() => handleBulkPriority("Urgent")}
            className="dk-btn dk-btn-tint dk-tint-urgent"
          >
            {t(PRIORITY_LABELS.Urgent)}
          </button>
          <Button onClick={() => handleBulkPriority("Default")}>
            {t(PRIORITY_LABELS.Default)}
          </Button>
        </div>
      </div>

      {/* Reorder (not in unified view) */}
      {!isUnifiedView && (
        <div className="mt-4">
          <label className="dk-label">
            {t("bulk.reorder")}
          </label>
          <Toolbar label={t("bulk.reorderLabel")} className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                const result = await sendToFirst(filePath);
                handleActionResult("reorder", message("bulk.reorderFailed"), result);
              }}
            >
              {t("action.tackle")}
            </Button>
            <Button
              onClick={async () => {
                const result = await moveUp(filePath);
                handleActionResult("reorder", message("bulk.reorderFailed"), result);
              }}
            >
              {t("action.moveUp")}
            </Button>
            <Button
              onClick={async () => {
                const result = await moveDown(filePath);
                handleActionResult("reorder", message("bulk.reorderFailed"), result);
              }}
            >
              {t("action.moveDown")}
            </Button>
            {kickDistances.map((d) => (
              <Button
                key={d}
                onClick={async () => {
                  const result = await kick(filePath, d);
                  handleActionResult("reorder", message("bulk.reorderFailed"), result);
                }}
              >
                +{d}
              </Button>
            ))}
            <Button
              onClick={async () => {
                const result = await sendToLast(filePath);
                handleActionResult("reorder", message("bulk.reorderFailed"), result);
              }}
            >
              {t("action.kick")}
            </Button>
            <Button
              onClick={async () => {
                const result = await dropkick(filePath);
                handleActionResult("reorder", message("bulk.reorderFailed"), result);
              }}
            >
              Dropkick
            </Button>
          </Toolbar>
        </div>
      )}

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mt-4">
          <label className="dk-label">
            {t("detail.moveTo")}
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="dk-field min-w-0 flex-1"
            >
              <option value="">{t("moveTasks.selectDestination")}</option>
              {moveDestinations.map((tab) => (
                <option key={tab.filePath} value={tab.filePath}>
                  {tab.displayName}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={handleMove} disabled={!moveTarget}>
              {t("moveTasks.move")}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8">
        {/* Opens the deletion path; the confirmation holds the filled commit. */}
        <Button variant="danger" onClick={() => void handleDelete()}>
          <Trash2 size={14} />
          {t("detail.delete")}
        </Button>
      </div>
    </div>
  );
}
