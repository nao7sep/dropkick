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
    <div className="flex h-full flex-col items-center justify-center p-8 text-gray-500">
      <h3 className="mb-6 text-lg font-medium text-gray-700">Task List Summary</h3>

      <div className="w-full max-w-xs space-y-3">
        <div className="flex justify-between">
          <span>Total tasks</span>
          <span className="font-medium text-gray-700">{tasks.length}</span>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <div className="flex justify-between">
            <span>Pending</span>
            <span className="font-medium">{pending}</span>
          </div>
          <div className="flex justify-between">
            <span>Completed</span>
            <span className="font-medium text-green-700">{completed}</span>
          </div>
          <div className="flex justify-between">
            <span>Dismissed</span>
            <span className="font-medium text-gray-500">{dismissed}</span>
          </div>
        </div>

        {pending > 0 && (
          <div className="border-t border-gray-100 pt-3">
            {critical > 0 && (
              <div className="flex justify-between">
                <span className="text-violet-700">Critical</span>
                <span className="font-medium text-violet-700">{critical}</span>
              </div>
            )}
            {important > 0 && (
              <div className="flex justify-between">
                <span className="text-blue-700">Important</span>
                <span className="font-medium text-blue-700">{important}</span>
              </div>
            )}
            {urgent > 0 && (
              <div className="flex justify-between">
                <span className="text-rose-700">Urgent</span>
                <span className="font-medium text-rose-700">{urgent}</span>
              </div>
            )}
          </div>
        )}

        {actionableNotes > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <div className="flex justify-between">
              <span className="text-orange-700">Actionable notes</span>
              <span className="font-medium text-orange-700">{actionableNotes}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
