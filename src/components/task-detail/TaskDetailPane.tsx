// Right pane — shows task detail (1 selected), summary (0), or bulk actions (2+).

import { useMemo } from "react";
import { useTaskListStore } from "../../state/task-list-store";
import { pickNextActiveKey, taskSelectionKey } from "../../utils";
import { useViewTasks } from "../../hooks/useViewTasks";
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
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);

  const { tasks, visualTasks } = useViewTasks(filePath, isUnifiedView);

  const selectedTasks = tasks.filter((t) => selectedKeys.has(taskSelectionKey(t)));
  const selectedTaskKeys = selectedTasks.map((t) => taskSelectionKey(t));
  const selectionKey = selectedTaskKeys.join("|");
  const nextActiveTaskKey = useMemo(
    () => pickNextActiveKey(selectedKeys, visualTasks),
    [selectedKeys, visualTasks],
  );

  if (selectedTasks.length === 1) {
    return (
      <TaskDetail
        key={`task:${taskSelectionKey(selectedTasks[0])}`}
        task={selectedTasks[0]}
        filePath={selectedTasks[0].sourceFile}
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
