import { useCallback } from "react";
import type { Task } from "../models";
import { showTaskDeletionConfirm } from "../repositories";
import {
  deleteSelectedTasks,
  type DeleteSelectedTasksResult,
} from "../services";
import { useNoteDraftStore } from "../state/note-draft-store";
import { usePreferencesStore } from "../state/preferences-store";
import { useTaskListStore } from "../state/task-list-store";
import { taskSelectionKey } from "../utils";

export function useTaskDeletion() {
  const confirmPermanentDeletions = usePreferencesStore(
    (state) => state.preferences.confirmPermanentDeletions,
  );
  const removeTasks = useTaskListStore((state) => state.removeTasks);
  const setSelection = useTaskListStore((state) => state.setSelection);
  const clearTaskDrafts = useNoteDraftStore((state) => state.clearTaskDrafts);

  return useCallback(
    async (
      tasks: readonly Task[],
      nextActiveTaskKey: string | null,
    ): Promise<DeleteSelectedTasksResult | null> => {
      if (tasks.length === 0) return null;
      if (
        confirmPermanentDeletions &&
        !(await showTaskDeletionConfirm(tasks))
      ) {
        return null;
      }

      const result = await deleteSelectedTasks({
        selectedTasks: tasks,
        removeTasks,
        clearTaskDrafts,
      });

      if (result.failedTasks.length === 0) {
        setSelection(
          nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set(),
        );
        return result;
      }

      // Successful files have already removed their keys. Name the failed set
      // explicitly so it remains visible and retryable after a partial result.
      setSelection(new Set(result.failedTasks.map(taskSelectionKey)));
      return result;
    },
    [
      confirmPermanentDeletions,
      removeTasks,
      clearTaskDrafts,
      setSelection,
    ],
  );
}
