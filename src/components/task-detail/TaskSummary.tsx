// Task summary — shown in right pane when 0 tasks are selected.
// Displays counts by status and priority.

import type React from "react";
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

  // One rule between each pair of groups that are both present, none for an
  // empty one: the priority group used to draw its rule whenever anything was
  // pending, even with no Critical, Important or Urgent row to show, leaving two
  // rules around an empty gap (interface-styling-conventions, "No stray
  // separators").
  const priorityRows = [
    { key: "priority.critical", count: critical, tone: "text-group-critical-fg" },
    { key: "priority.important", count: important, tone: "text-group-important-fg" },
    { key: "priority.urgent", count: urgent, tone: "text-group-urgent-fg" },
  ] as const;
  const visiblePriorities = priorityRows.filter((row) => row.count > 0);

  const groups: React.ReactNode[] = [
    <div key="total" className="flex justify-between">
      <span>{t("summary.total")}</span>
      <span className="font-medium text-ink">{number(tasks.length)}</span>
    </div>,
    <div key="status">
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
    </div>,
  ];
  if (visiblePriorities.length > 0) {
    groups.push(
      <div key="priority">
        {visiblePriorities.map((row) => (
          <div key={row.key} className="flex justify-between">
            <span className={row.tone}>{t(row.key)}</span>
            <span className={`font-medium ${row.tone}`}>{number(row.count)}</span>
          </div>
        ))}
      </div>,
    );
  }
  if (actionableNotes > 0) {
    groups.push(
      <div key="notes" className="flex justify-between">
        <span className="text-attention">{t("summary.actionableNotes")}</span>
        <span className="font-medium text-attention">{number(actionableNotes)}</span>
      </div>,
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-ink-muted">
      <h3 className="mb-6 text-lg font-semibold text-ink-strong">{t("summary.title")}</h3>

      <div data-summary-groups="" className="w-full max-w-xs divide-y divide-border-subtle">
        {groups.map((group, index) => (
          <div key={index} className={index === 0 ? "pb-3" : "py-3 last:pb-0"}>
            {group}
          </div>
        ))}
      </div>
    </div>
  );
}
