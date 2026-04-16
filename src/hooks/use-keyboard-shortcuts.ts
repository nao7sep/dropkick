// Global keyboard shortcuts — registered once in MainWindow.
// Handles task creation, task actions, navigation, reorder, tab switching, etc.
// Shortcuts are suppressed when the user is typing in an input/textarea/select.

import { useEffect, useCallback, useMemo } from "react";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { usePreferencesStore } from "../state/preferences-store";
import { showConfirm, showMessage } from "../repositories";
import { groupTasksForList, groupTasksForUnifiedView } from "../services";
import type { Task, TaskPriority, TaskStatus } from "../models";
import { toTask, todayInTimezone, tomorrowInTimezone } from "../utils";
import { hasPrimaryShortcutModifier, matchesShortcutKey } from "../utils";

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

function isInsideInteractiveLayer(e: KeyboardEvent): boolean {
  return (
    (e.target as HTMLElement | null)?.closest(
      "[data-dropkick-interactive-layer]",
    ) !== null
  );
}

export function useKeyboardShortcuts(
  filePath: string,
  isUnifiedView: boolean,
  onNewTask: () => void,
  onMoveTasks: () => void,
  onFocusNewNote: () => void,
) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const files = useTaskListStore((s) => s.files);
  const selectedIds = useTaskListStore((s) => s.selectedIds);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const setStatus = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const setDueDate = useTaskListStore((s) => s.setDueDate);
  const moveUp = useTaskListStore((s) => s.moveUp);
  const moveDown = useTaskListStore((s) => s.moveDown);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);

  const timezone = preferences.timezone;
  const dueSoonDays = preferences.dueSoonDays;

  const contextTasks: Task[] = useMemo(() => {
    const tasks: Task[] = [];
    if (isUnifiedView) {
      for (const tab of workspace.openTabs) {
        if (tab.isUnifiedView) continue;
        const fileState = files[tab.filePath];
        if (!fileState) continue;
        for (const dto of fileState.data.tasks) {
          tasks.push(toTask(dto, tab.filePath, timezone, dueSoonDays));
        }
      }
    } else {
      const fileState = files[filePath];
      if (!fileState) return [];
      for (const dto of fileState.data.tasks) {
        tasks.push(toTask(dto, filePath, timezone, dueSoonDays));
      }
    }

    return tasks;
  }, [files, filePath, isUnifiedView, timezone, dueSoonDays, workspace.openTabs]);

  // Compute tasks in visual (grouped) order for arrow navigation.
  const visualTasks: Task[] = useMemo(() => {
    // Group and flatten to get visual order.
    const grouped = isUnifiedView
      ? groupTasksForUnifiedView(contextTasks)
      : groupTasksForList(contextTasks);

    return grouped.groups.flatMap((g) => g.tasks);
  }, [contextTasks, isUnifiedView]);

  const tasksById = useMemo(
    () => new Map(contextTasks.map((task) => [task.id, task])),
    [contextTasks],
  );

  const selectedTasks = useMemo(
    () =>
      [...selectedIds]
        .map((taskId) => tasksById.get(taskId))
        .filter((task): task is Task => task !== undefined),
    [selectedIds, tasksById],
  );

  const applyStatusToSelection = useCallback(
    async (status: TaskStatus) => {
      if (selectedTasks.length === 0) return;

      const validationReasons = new Map<string, number>();
      let firstError: string | null = null;

      for (const task of selectedTasks) {
        const result = await setStatus(task.sourceFile, task.id, status);
        if (result.status === "validation") {
          validationReasons.set(
            result.reason,
            (validationReasons.get(result.reason) ?? 0) + 1,
          );
        } else if (result.status === "error" && firstError === null) {
          firstError = result.message;
        }
      }

      if (validationReasons.size > 0) {
        const skippedCount = [...validationReasons.values()].reduce(
          (total, count) => total + count,
          0,
        );
        const details = [...validationReasons.entries()]
          .map(([reason, count]) =>
            count === 1 ? reason : `${reason} (${count} tasks)`,
          )
          .join("; ");
        await showMessage(
          "Some Tasks Were Skipped",
          `Skipped ${skippedCount} task(s): ${details}.`,
        );
        return;
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
      }
    },
    [selectedTasks, setStatus],
  );

  const applyPriorityToSelection = useCallback(
    async (priority: TaskPriority) => {
      if (selectedTasks.length === 0) return;

      let firstError: string | null = null;
      for (const task of selectedTasks) {
        const result = await setPriority(task.sourceFile, task.id, priority);
        if (result.status === "error" && firstError === null) {
          firstError = result.message;
        }
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
      }
    },
    [selectedTasks, setPriority],
  );

  const applyDueDateToSelection = useCallback(
    async (dueDate: string | null) => {
      if (selectedTasks.length === 0) return;

      let firstError: string | null = null;
      for (const task of selectedTasks) {
        const result = await setDueDate(task.sourceFile, task.id, dueDate);
        if (result.status === "error" && firstError === null) {
          firstError = result.message;
        }
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
      }
    },
    [selectedTasks, setDueDate],
  );

  const handler = useCallback(
    async (e: KeyboardEvent) => {
      if (isInsideInteractiveLayer(e)) return;

      const mod = hasPrimaryShortcutModifier(e);
      const hasNonShiftModifier = e.metaKey || e.ctrlKey || e.altKey;

      // --- Primary modifier + N: New task modal ---
      if (mod && !e.shiftKey && matchesShortcutKey(e, "n")) {
        e.preventDefault();
        onNewTask();
        return;
      }

      // --- Primary modifier + M: Move selected tasks to another list ---
      if (mod && !e.shiftKey && matchesShortcutKey(e, "m")) {
        if (selectedIds.size === 0) return;
        e.preventDefault();
        onMoveTasks();
        return;
      }

      // --- Primary modifier + Shift + N: Focus the new note field.
      // Normalize the letter match so shifted shortcuts do not depend on
      // whether the underlying webview reports "n" or "N".
      if (mod && e.shiftKey && matchesShortcutKey(e, "n")) {
        if (selectedIds.size !== 1) return;
        e.preventDefault();
        onFocusNewNote();
        return;
      }

      // --- P/C/X: Change status for the current selection ---
      if (
        !hasNonShiftModifier &&
        !e.shiftKey &&
        !e.repeat &&
        !isTyping(e) &&
        selectedTasks.length > 0
      ) {
        if (matchesShortcutKey(e, "p")) {
          e.preventDefault();
          await applyStatusToSelection("Pending");
          return;
        }

        if (matchesShortcutKey(e, "c")) {
          e.preventDefault();
          await applyStatusToSelection("Completed");
          return;
        }

        if (matchesShortcutKey(e, "x")) {
          e.preventDefault();
          await applyStatusToSelection("Dismissed");
          return;
        }

        if (e.key === "1") {
          e.preventDefault();
          await applyPriorityToSelection("Default");
          return;
        }

        if (e.key === "2") {
          e.preventDefault();
          await applyPriorityToSelection("Important");
          return;
        }

        if (e.key === "3") {
          e.preventDefault();
          await applyPriorityToSelection("Urgent");
          return;
        }

        if (e.key === "4") {
          e.preventDefault();
          await applyPriorityToSelection("Critical");
          return;
        }

        if (matchesShortcutKey(e, "t")) {
          e.preventDefault();
          await applyDueDateToSelection(todayInTimezone(timezone));
          return;
        }

        if (matchesShortcutKey(e, "y")) {
          e.preventDefault();
          await applyDueDateToSelection(tomorrowInTimezone(timezone));
          return;
        }

        if (matchesShortcutKey(e, "n")) {
          e.preventDefault();
          await applyDueDateToSelection(null);
          return;
        }
      }

      // --- Delete/Backspace: Dismiss selected tasks ---
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isTyping(e)) return;
        if (selectedIds.size === 0) return;
        e.preventDefault();
        const confirmed = await showConfirm(
          "Dismiss Tasks",
          `Dismiss ${selectedIds.size} selected task(s)?`,
        );
        if (!confirmed) return;
        for (const taskId of selectedIds) {
          const taskFile = tasksById.get(taskId)?.sourceFile ?? filePath;
          await setStatus(taskFile, taskId, "Dismissed");
        }
        return;
      }

      // --- Primary modifier + Up: Move selection up one position ---
      if (mod && !e.shiftKey && e.key === "ArrowUp") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await moveUp(filePath);
        return;
      }

      // --- Primary modifier + Down: Move selection down one position ---
      if (mod && !e.shiftKey && e.key === "ArrowDown") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await moveDown(filePath);
        return;
      }

      // --- Primary modifier + Home: Send to first in group (Tackle) ---
      if (mod && e.key === "Home") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await sendToFirst(filePath);
        return;
      }

      // --- Primary modifier + End: Send to last in group (Kick) ---
      if (mod && e.key === "End") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await sendToLast(filePath);
        return;
      }

      // --- ↑/↓: Move selection (visual order) ---
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (isTyping(e) || mod) return;
        if (visualTasks.length === 0) return;
        e.preventDefault();

        const direction = e.key === "ArrowDown" ? 1 : -1;

        if (selectedIds.size === 0) {
          const task =
            direction === 1
              ? visualTasks[0]
              : visualTasks[visualTasks.length - 1];
          setSelection(new Set([task.id]));
          return;
        }

        // Find the anchor — last item in the selection set.
        const lastId = [...selectedIds].pop()!;
        const currentIdx = visualTasks.findIndex((t) => t.id === lastId);
        if (currentIdx === -1) {
          setSelection(new Set([visualTasks[0].id]));
          return;
        }

        const nextIdx = currentIdx + direction;
        if (nextIdx < 0 || nextIdx >= visualTasks.length) return;

        if (e.shiftKey) {
          const next = new Set(selectedIds);
          next.add(visualTasks[nextIdx].id);
          setSelection(next);
        } else {
          setSelection(new Set([visualTasks[nextIdx].id]));
        }
        return;
      }

      // --- Primary modifier + Tab / Primary modifier + Shift + Tab: Switch tabs ---
      if (mod && e.key === "Tab") {
        e.preventDefault();
        const tabs = workspace.openTabs;
        if (tabs.length <= 1) return;
        const current = workspace.activeTabIndex;
        const direction = e.shiftKey ? -1 : 1;
        const next = (current + direction + tabs.length) % tabs.length;
        await setActiveTab(next);
        return;
      }

      // --- Primary modifier + W: Close current tab ---
      if (mod && matchesShortcutKey(e, "w")) {
        e.preventDefault();
        const idx = workspace.activeTabIndex;
        if (idx >= 0 && idx < workspace.openTabs.length) {
          await closeTab(idx);
        }
        return;
      }

      // --- Primary modifier + U: Open unified view ---
      if (mod && matchesShortcutKey(e, "u")) {
        e.preventDefault();
        await addUnifiedViewTab();
        return;
      }

      // --- Escape: Clear selection ---
      if (e.key === "Escape") {
        if (isTyping(e)) return;
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelection(new Set());
        }
        return;
      }
    },
    [
      filePath,
      isUnifiedView,
      selectedIds,
      selectedTasks,
      tasksById,
      timezone,
      applyStatusToSelection,
      applyPriorityToSelection,
      applyDueDateToSelection,
      visualTasks,
      workspace.openTabs,
      workspace.activeTabIndex,
      onNewTask,
      onMoveTasks,
      onFocusNewNote,
      setStatus,
      setPriority,
      setDueDate,
      moveUp,
      moveDown,
      sendToFirst,
      sendToLast,
      setSelection,
      setActiveTab,
      closeTab,
      addUnifiedViewTab,
    ],
  );

  useEffect(() => {
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handler]);
}
