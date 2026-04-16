// Right pane — shows task detail (1 selected), summary (0), or bulk actions (2+).

import { useMemo } from "react";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { toTask } from "../../utils";
import type { Task } from "../../models";
import { TaskDetail } from "./TaskDetail";
import { TaskSummary } from "./TaskSummary";
import { BulkActions } from "./BulkActions";

interface TaskDetailPaneProps {
  filePath: string;
  isUnifiedView: boolean;
  focusNewNoteSignal: number;
}

export function TaskDetailPane({
  filePath,
  isUnifiedView,
  focusNewNoteSignal,
}: TaskDetailPaneProps) {
  const timezone = usePreferencesStore((s) => s.preferences.timezone);
  const dueSoonDays = usePreferencesStore((s) => s.preferences.dueSoonDays);
  const selectedIds = useTaskListStore((s) => s.selectedIds);
  const openTabs = useWorkspaceStore((s) => s.workspace.openTabs);

  // Select raw data from store (stable reference), compute domain models in useMemo.
  const files = useTaskListStore((s) => s.files);

  const tasks = useMemo(() => {
    if (isUnifiedView) {
      const allTasks: Task[] = [];
      for (const tab of openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          allTasks.push(toTask(dto, tab.filePath, timezone, dueSoonDays));
        }
      }
      return allTasks;
    }
    const fileState = files[filePath];
    if (!fileState) return [] as Task[];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone, dueSoonDays));
  }, [files, filePath, isUnifiedView, timezone, dueSoonDays, openTabs]);

  const selectedTasks = tasks.filter((t) => selectedIds.has(t.id));
  const selectedTaskIds = selectedTasks.map((t) => t.id);
  const selectionKey = selectedTaskIds.join("|");

  if (selectedTasks.length === 1) {
    return (
      <TaskDetail
        key={`task:${selectedTasks[0].id}`}
        task={selectedTasks[0]}
        filePath={isUnifiedView ? selectedTasks[0].sourceFile : filePath}
        focusNewNoteSignal={focusNewNoteSignal}
      />
    );
  }

  if (selectedTasks.length > 1) {
    return (
      <BulkActions
        key={`bulk:${selectionKey}`}
        selectedTasks={selectedTasks}
        filePath={filePath}
        isUnifiedView={isUnifiedView}
      />
    );
  }

  return <TaskSummary key={`summary:${isUnifiedView ? "__unified__" : filePath}`} tasks={tasks} />;
}
