import type { Task } from "../../models";
import { taskSelectionKey } from "../../utils";

interface SelectedTaskTitleListProps {
  tasks: Task[];
  className?: string;
}

export function SelectedTaskTitleList({
  tasks,
  className = "",
}: SelectedTaskTitleListProps) {
  return (
    <ul
      className={`list-disc space-y-1 pl-5 text-sm text-ink-muted ${className}`.trim()}
    >
      {tasks.map((task) => (
        <li key={taskSelectionKey(task)} className="truncate">
          {task.title || "Untitled"}
        </li>
      ))}
    </ul>
  );
}
