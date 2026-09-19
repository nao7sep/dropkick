import type { Task } from "../../models";
import { taskSelectionKey } from "../../utils";
import { useI18n } from "../../i18n/I18nContext";

interface SelectedTaskTitleListProps {
  tasks: Task[];
  className?: string;
}

export function SelectedTaskTitleList({
  tasks,
  className = "",
}: SelectedTaskTitleListProps) {
  const { t } = useI18n();
  return (
    <ul
      className={`list-inside list-disc space-y-1 text-sm text-ink-muted ${className}`.trim()}
    >
      {tasks.map((task) => (
        <li key={taskSelectionKey(task)} className="truncate">
          {task.title || t("common.untitled")}
        </li>
      ))}
    </ul>
  );
}
