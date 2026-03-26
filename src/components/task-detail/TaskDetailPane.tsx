// Right pane — shows task detail (1 selected), summary (0), or bulk actions (2+).

import { useMemo } from "react";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { toTask } from "../../utils";
import type { Task } from "../../models";
import { TaskDetail } from "./TaskDetail";
import { TaskSummary } from "./TaskSummary";
import { BulkActions } from "./BulkActions";

interface TaskDetailPaneProps {
  filePath: string;
  isUnifiedView: boolean;
}

export function TaskDetailPane({ filePath, isUnifiedView }: TaskDetailPaneProps) {
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const selectedIds = useTaskListStore((s) => s.selectedIds);

  // Select raw data from store (stable reference), compute domain models in useMemo.
  const files = useTaskListStore((s) => s.files);

  const tasks = useMemo(() => {
    if (isUnifiedView) {
      const allTasks: Task[] = [];
      for (const [fp, fileState] of Object.entries(files)) {
        for (const dto of fileState.data.tasks) {
          allTasks.push(toTask(dto, fp, timezone));
        }
      }
      return allTasks;
    }
    const fileState = files[filePath];
    if (!fileState) return [] as Task[];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone));
  }, [files, filePath, isUnifiedView, timezone]);

  const selectedTasks = tasks.filter((t) => selectedIds.has(t.id));

  if (selectedTasks.length === 1) {
    return (
      <TaskDetail
        task={selectedTasks[0]}
        filePath={isUnifiedView ? selectedTasks[0].sourceFile : filePath}
      />
    );
  }

  if (selectedTasks.length > 1) {
    return (
      <BulkActions
        selectedTasks={selectedTasks}
        filePath={filePath}
        isUnifiedView={isUnifiedView}
      />
    );
  }

  return <TaskSummary tasks={tasks} />;
}
