// Right pane — shows task detail (1 selected), summary (0), or bulk actions (2+).

import { useMemo } from "react";
import { useTaskListStore } from "../../state/task-list-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { pickNextActiveKey, taskSelectionKey, toTask } from "../../utils";
import {
  groupTasksForList,
  groupTasksForUnifiedView,
} from "../../services";
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
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
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

  const selectedTasks = tasks.filter((t) => selectedKeys.has(taskSelectionKey(t)));
  const selectedTaskKeys = selectedTasks.map((t) => taskSelectionKey(t));
  const selectionKey = selectedTaskKeys.join("|");
  const visualTasks = useMemo(() => {
    const grouped = isUnifiedView
      ? groupTasksForUnifiedView(tasks)
      : groupTasksForList(tasks);

    return grouped.groups.flatMap((group) => group.tasks);
  }, [tasks, isUnifiedView]);
  const nextActiveTaskKey = useMemo(
    () => pickNextActiveKey(selectedKeys, visualTasks),
    [selectedKeys, visualTasks],
  );

  if (selectedTasks.length === 1) {
    return (
      <TaskDetail
        key={`task:${taskSelectionKey(selectedTasks[0])}`}
        task={selectedTasks[0]}
        filePath={isUnifiedView ? selectedTasks[0].sourceFile : filePath}
        isUnifiedView={isUnifiedView}
        nextActiveTaskKey={nextActiveTaskKey}
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
        nextActiveTaskKey={nextActiveTaskKey}
      />
    );
  }

  return <TaskSummary key={`summary:${isUnifiedView ? "__unified__" : filePath}`} tasks={tasks} />;
}
