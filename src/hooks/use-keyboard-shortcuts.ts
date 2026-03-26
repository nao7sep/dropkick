// Global keyboard shortcuts — registered once in MainWindow.
// Handles task creation, navigation, kick, tab switching, etc.
// Shortcuts are suppressed when the user is typing in an input/textarea/select.

import { useEffect, useCallback, useMemo } from "react";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { usePreferencesStore } from "../state/preferences-store";
import { showConfirm } from "../repositories";
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
) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const files = useTaskListStore((s) => s.files);
  const selectedIds = useTaskListStore((s) => s.selectedIds);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const addNewTask = useTaskListStore((s) => s.addNewTask);
  const addNewNote = useTaskListStore((s) => s.addNewNote);
  const setStatus = useTaskListStore((s) => s.setStatus);
  const kick = useTaskListStore((s) => s.kick);
  const kickToEnd = useTaskListStore((s) => s.kickToEnd);

  const workspace = useWorkspaceStore((s) => s.workspace);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const addUnifiedViewTab = useWorkspaceStore((s) => s.addUnifiedViewTab);

  const timezone = preferences.timezone;
  const kickDistances = preferences.kickDistances;

  // Compute flat task list for arrow navigation.
  const allTasks: Task[] = useMemo(() => {
    if (isUnifiedView) {
      const tasks: Task[] = [];
      for (const [fp, fileState] of Object.entries(files)) {
        for (const dto of fileState.data.tasks) {
          tasks.push(toTask(dto, fp, timezone));
        }
      }
      return tasks;
    }
    const fileState = files[filePath];
    if (!fileState) return [];
    return fileState.data.tasks.map((dto) => toTask(dto, filePath, timezone));
  }, [files, filePath, isUnifiedView, timezone]);

  // Only active (Pending) tasks for navigation — they're the ones visible in groups.
  const activeTasks = useMemo(
    () => allTasks.filter((t) => t.status === "Pending"),
    [allTasks],
  );

  const handler = useCallback(
    async (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // --- Ctrl/Cmd+N: New task ---
      if (mod && !e.shiftKey && e.key === "n") {
        if (isTyping(e)) return;
        if (isUnifiedView) return; // Can't create tasks in unified view.
        e.preventDefault();
        await addNewTask(filePath, "");
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

      // --- Ctrl/Cmd+↓: Short kick ---
      if (mod && !e.shiftKey && e.key === "ArrowDown") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        const distance = kickDistances[0] ?? 5;
        await kick(filePath, distance);
        return;
      }

      // --- Ctrl/Cmd+Shift+↓: Long kick ---
      if (mod && e.shiftKey && e.key === "ArrowDown") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        const distance = kickDistances[1] ?? 25;
        await kick(filePath, distance);
        return;
      }

      // --- Ctrl/Cmd+End: Kick to end ---
      if (mod && e.key === "End") {
        if (isTyping(e)) return;
        if (isUnifiedView || selectedIds.size === 0) return;
        e.preventDefault();
        await kickToEnd(filePath);
        return;
      }

      // --- ↑/↓: Move selection ---
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (isTyping(e) || mod) return;
        if (activeTasks.length === 0) return;
        e.preventDefault();

        const direction = e.key === "ArrowDown" ? 1 : -1;

        if (selectedIds.size === 0) {
          // Nothing selected — select first or last.
          const task =
            direction === 1
              ? activeTasks[0]
              : activeTasks[activeTasks.length - 1];
          setSelection(new Set([task.id]));
          return;
        }

        // Find the "anchor" — the last item in the selection set.
        const lastId = [...selectedIds].pop()!;
        const currentIdx = activeTasks.findIndex((t) => t.id === lastId);
        if (currentIdx === -1) {
          setSelection(new Set([activeTasks[0].id]));
          return;
        }

        const nextIdx = currentIdx + direction;
        if (nextIdx < 0 || nextIdx >= activeTasks.length) return;

        if (e.shiftKey) {
          // Extend selection.
          const next = new Set(selectedIds);
          next.add(activeTasks[nextIdx].id);
          setSelection(next);
        } else {
          // Move selection.
          setSelection(new Set([activeTasks[nextIdx].id]));
        }
        return;
      }

      // --- Ctrl/Cmd+Tab / Ctrl/Cmd+Shift+Tab: Switch tabs ---
      // Note: some browsers intercept Ctrl+Tab. We try anyway.
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
      activeTasks,
      allTasks,
      kickDistances,
      workspace.openTabs,
      workspace.activeTabIndex,
      addNewTask,
      addNewNote,
      setStatus,
      kick,
      kickToEnd,
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
