// Global keyboard shortcuts — registered once in MainWindow.
// Handles task creation, navigation, reorder, tab switching, etc.
// Shortcuts are suppressed when the user is typing in an input/textarea/select.

import { useEffect, useCallback, useMemo } from "react";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { usePreferencesStore } from "../state/preferences-store";
import { showConfirm } from "../repositories";
import { groupTasksForList, groupTasksForUnifiedView } from "../services";
import type { Task } from "../models";
import { toTask } from "../utils";

function isTyping(e: KeyboardEvent): boolean {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((e.target as HTMLElement)?.isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(
  filePath: string,
  isUnifiedView: boolean,
  onNewTask: () => void,
) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const files = useTaskListStore((s) => s.files);
  const selectedIds = useTaskListStore((s) => s.selectedIds);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const addNewNote = useTaskListStore((s) => s.addNewNote);
  const setStatus = useTaskListStore((s) => s.setStatus);
  const moveUp = useTaskListStore((s) => s.moveUp);
  const moveDown = useTaskListStore((s) => s.moveDown);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);

  const timezone = preferences.timezone;

  // Compute tasks in visual (grouped) order for arrow navigation.
  const visualTasks: Task[] = useMemo(() => {
    const allTasks: Task[] = [];
    if (isUnifiedView) {
      for (const [fp, fileState] of Object.entries(files)) {
        for (const dto of fileState.data.tasks) {
          allTasks.push(toTask(dto, fp, timezone));
        }
      }
    } else {
      const fileState = files[filePath];
      if (!fileState) return [];
      for (const dto of fileState.data.tasks) {
        allTasks.push(toTask(dto, filePath, timezone));
      }
    }

    // Group and flatten to get visual order.
    const grouped = isUnifiedView
      ? groupTasksForUnifiedView(allTasks)
      : groupTasksForList(allTasks);

    return grouped.groups.flatMap((g) => g.tasks);
  }, [files, filePath, isUnifiedView, timezone]);

  // All tasks (for finding sourceFile in unified view).
  const allTasks: Task[] = useMemo(() => {
    if (!isUnifiedView) return [];
    const tasks: Task[] = [];
    for (const [fp, fileState] of Object.entries(files)) {
      for (const dto of fileState.data.tasks) {
        tasks.push(toTask(dto, fp, timezone));
      }
    }
    return tasks;
  }, [files, isUnifiedView, timezone]);

  const handler = useCallback(
    async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // --- Ctrl/Cmd+N: New task modal ---
      if (mod && !e.shiftKey && e.key === "n") {
        if (isTyping(e)) return;
        e.preventDefault();
        onNewTask();
        return;
      }

      // --- Ctrl/Cmd+Shift+N: New note on selected task ---
      if (mod && e.shiftKey && e.key === "N") {
        if (isTyping(e)) return;
        if (selectedIds.size !== 1) return;
        e.preventDefault();
        const taskId = [...selectedIds][0];
        const taskFile = isUnifiedView
          ? allTasks.find((t) => t.id === taskId)?.sourceFile ?? filePath
          : filePath;
        await addNewNote(taskFile, taskId, "");
        return;
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
          const taskFile = isUnifiedView
            ? allTasks.find((t) => t.id === taskId)?.sourceFile ?? filePath
            : filePath;
          await setStatus(taskFile, taskId, "Dismissed");
        }
        return;
      }

      // --- Ctrl/Cmd+Up: Move selection up one position ---
      if (mod && !e.shiftKey && e.key === "ArrowUp") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await moveUp(filePath);
        return;
      }

      // --- Ctrl/Cmd+Down: Move selection down one position ---
      if (mod && !e.shiftKey && e.key === "ArrowDown") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await moveDown(filePath);
        return;
      }

      // --- Ctrl/Cmd+Home: Send to first in group (Tackle) ---
      if (mod && e.key === "Home") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await sendToFirst(filePath);
        return;
      }

      // --- Ctrl/Cmd+End: Send to last in group (Kick) ---
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

      // --- Ctrl/Cmd+Tab / Ctrl/Cmd+Shift+Tab: Switch tabs ---
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

      // --- Ctrl/Cmd+W: Close current tab ---
      if (mod && e.key === "w") {
        if (isTyping(e)) return;
        e.preventDefault();
        const idx = workspace.activeTabIndex;
        if (idx >= 0 && idx < workspace.openTabs.length) {
          await closeTab(idx);
        }
        return;
      }

      // --- Ctrl/Cmd+U: Open unified view ---
      if (mod && e.key === "u") {
        if (isTyping(e)) return;
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
      visualTasks,
      allTasks,
      workspace.openTabs,
      workspace.activeTabIndex,
      onNewTask,
      addNewNote,
      setStatus,
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
