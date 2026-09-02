// Right pane — shows task detail (1 selected), summary (0), or bulk actions (2+).

import { useMemo } from "react";
import { useTaskListStore } from "../../state/task-list-store";
import { pickNextActiveKey, taskSelectionKey } from "../../utils";
import { useViewTasks } from "../../hooks/useViewTasks";
import { taskActionOwnerKey } from "../../services";
import { TaskDetail } from "./TaskDetail";
import { TaskSummary } from "./TaskSummary";
import { BulkActions } from "./BulkActions";

interface TaskDetailPaneProps {
  filePath: string;
  isUnifiedView: boolean;
  focusNewNoteSignal: number;
  externalIssues?: Record<string, { title: string; message: string }>;
  onDismissExternalIssue?: (ownerKey: string) => void;
  onReportExternalIssue?: (
    ownerKeys: readonly string[],
    title: string,
    message: string,
  ) => void;
}

export function TaskDetailPane({
  filePath,
  isUnifiedView,
  focusNewNoteSignal,
  externalIssues,
  onDismissExternalIssue,
  onReportExternalIssue,
}: TaskDetailPaneProps) {
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);

  const { tasks, visualTasks } = useViewTasks(filePath, isUnifiedView);

  const selectedTasks = tasks.filter((t) => selectedKeys.has(taskSelectionKey(t)));
  const selectedTaskKeys = selectedTasks.map((t) => taskSelectionKey(t));
  const selectionKey = selectedTaskKeys.join("|");
  const selectionOwnerKey = taskActionOwnerKey(selectedTaskKeys);
  const activeIssue = externalIssues?.[selectionOwnerKey] ?? null;
  const dismissActiveIssue = onDismissExternalIssue
    ? () => onDismissExternalIssue(selectionOwnerKey)
    : undefined;
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
        externalIssue={activeIssue}
        onDismissExternalIssue={dismissActiveIssue}
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
        externalIssue={activeIssue}
        onDismissExternalIssue={dismissActiveIssue}
        onReportExternalIssue={onReportExternalIssue}
      />
    );
  }

  return <TaskSummary key={`summary:${isUnifiedView ? "__unified__" : filePath}`} tasks={tasks} />;
}
