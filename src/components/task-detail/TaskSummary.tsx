// Task summary — shown in right pane when 0 tasks are selected.
// Displays counts by status and priority.

import type { Task } from "../../models";

interface TaskSummaryProps {
  tasks: Task[];
}

export function TaskSummary({ tasks }: TaskSummaryProps) {
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
      <h3 className="mb-6 text-lg font-medium text-ink">Task List Summary</h3>

      <div className="w-full max-w-xs space-y-3">
        <div className="flex justify-between">
          <span>Total tasks</span>
          <span className="font-medium text-ink">{tasks.length}</span>
        </div>

        <div className="border-t border-border-subtle pt-3">
          <div className="flex justify-between">
            <span>Pending</span>
            <span className="font-medium">{pending}</span>
          </div>
          <div className="flex justify-between">
            <span>Completed</span>
            <span className="font-medium text-success">{completed}</span>
          </div>
          <div className="flex justify-between">
            <span>Dismissed</span>
            <span className="font-medium text-ink-muted">{dismissed}</span>
          </div>
        </div>

        {pending > 0 && (
          <div className="border-t border-border-subtle pt-3">
            {critical > 0 && (
              <div className="flex justify-between">
                <span className="text-group-critical-fg">Critical</span>
                <span className="font-medium text-group-critical-fg">{critical}</span>
              </div>
            )}
            {important > 0 && (
              <div className="flex justify-between">
                <span className="text-group-important-fg">Important</span>
                <span className="font-medium text-group-important-fg">{important}</span>
              </div>
            )}
            {urgent > 0 && (
              <div className="flex justify-between">
                <span className="text-group-urgent-fg">Urgent</span>
                <span className="font-medium text-group-urgent-fg">{urgent}</span>
              </div>
            )}
          </div>
        )}

        {actionableNotes > 0 && (
          <div className="border-t border-border-subtle pt-3">
            <div className="flex justify-between">
              <span className="text-attention">Actionable notes</span>
              <span className="font-medium text-attention">{actionableNotes}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
