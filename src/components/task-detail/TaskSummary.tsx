// Task summary — shown in right pane when 0 tasks are selected.
// Displays counts by status and priority.

import type { Task } from "../../models";
import { useI18n } from "../../i18n/I18nContext";

interface TaskSummaryProps {
  tasks: Task[];
}

export function TaskSummary({ tasks }: TaskSummaryProps) {
  const { t, number } = useI18n();
  const pending = tasks.filter((t) => t.status === "Pending").length;
  const completed = tasks.filter((t) => t.status === "Completed").length;
  const dismissed = tasks.filter((t) => t.status === "Dismissed").length;

  const critical = tasks.filter((t) => t.status === "Pending" && t.priority === "Critical").length;
  const important = tasks.filter((t) => t.status === "Pending" && t.priority === "Important").length;
  const urgent = tasks.filter((t) => t.status === "Pending" && t.priority === "Urgent").length;

  const actionableNotes = tasks.reduce(
    (count, t) => count + t.notes.filter((n) => n.actionability === "Actionable").length,
    0,
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-ink-muted">
      <h3 className="mb-6 text-lg font-medium text-ink">{t("summary.title")}</h3>

      <div className="w-full max-w-xs space-y-3">
        <div className="flex justify-between">
          <span>{t("summary.total")}</span>
          <span className="font-medium text-ink">{number(tasks.length)}</span>
        </div>

        <div className="border-t border-border-subtle pt-3">
          <div className="flex justify-between">
            <span>{t("status.pending")}</span>
            <span className="font-medium">{number(pending)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("status.completed")}</span>
            <span className="font-medium text-success">{number(completed)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("status.dismissed")}</span>
            <span className="font-medium text-ink-muted">{number(dismissed)}</span>
          </div>
        </div>

        {pending > 0 && (
          <div className="border-t border-border-subtle pt-3">
            {critical > 0 && (
              <div className="flex justify-between">
                <span className="text-group-critical-fg">{t("priority.critical")}</span>
                <span className="font-medium text-group-critical-fg">{number(critical)}</span>
              </div>
            )}
            {important > 0 && (
              <div className="flex justify-between">
                <span className="text-group-important-fg">{t("priority.important")}</span>
                <span className="font-medium text-group-important-fg">{number(important)}</span>
              </div>
            )}
            {urgent > 0 && (
              <div className="flex justify-between">
                <span className="text-group-urgent-fg">{t("priority.urgent")}</span>
                <span className="font-medium text-group-urgent-fg">{number(urgent)}</span>
              </div>
            )}
          </div>
        )}

        {actionableNotes > 0 && (
          <div className="border-t border-border-subtle pt-3">
            <div className="flex justify-between">
              <span className="text-attention">{t("summary.actionableNotes")}</span>
              <span className="font-medium text-attention">{number(actionableNotes)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
