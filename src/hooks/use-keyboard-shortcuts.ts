// Global keyboard shortcuts — registered once in MainWindow.
// Handles task creation, task actions, navigation, reorder, tab switching, etc.
// Shortcuts are suppressed when the user is typing in an input/textarea/select.

import { useEffect, useCallback, useMemo } from "react";
import { useTaskListStore } from "../state/task-list-store";
import { useWorkspaceStore } from "../state/workspace-store";
import { usePreferencesStore } from "../state/preferences-store";
import { useToastStore } from "../state/toast-store";
import { showConfirm, showMessage } from "../repositories";
import { groupTasksForList, groupTasksForUnifiedView } from "../services";
import type { Task, TaskPriority, TaskStatus } from "../models";
import {
  pickNextActiveKey,
  taskSelectionKey,
  toTask,
  todayInTimezone,
  tomorrowInTimezone,
} from "../utils";
import {
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
  consumesSpace,
  isOpenSettingsShortcut,
  isOpenShortcutsHelpShortcut,
  tabCycleDirection,
} from "../utils";

// Toast messages for actions that are silently disabled in unified view. They
// lead with the view because that is the part users forget — an empty selection
// is visible on screen, but "I'm in unified view" is not.
const UNIFIED_DROPKICK_MSG =
  "You're in unified view — Dropkick works in a single list.";
const UNIFIED_REORDER_MSG =
  "You're in unified view — reordering works in a single list.";

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
  onOpenSettings: () => void,
  onOpenShortcutsHelp: () => void,
) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const files = useTaskListStore((s) => s.files);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const setStatus = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const setDueDate = useTaskListStore((s) => s.setDueDate);
  const moveUp = useTaskListStore((s) => s.moveUp);
  const moveDown = useTaskListStore((s) => s.moveDown);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);
  const dropkick = useTaskListStore((s) => s.dropkick);

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

  const tasksByKey = useMemo(
    () => new Map(contextTasks.map((task) => [taskSelectionKey(task), task])),
    [contextTasks],
  );

  const selectedTasks = useMemo(
    () =>
      [...selectedKeys]
        .map((taskKey) => tasksByKey.get(taskKey))
        .filter((task): task is Task => task !== undefined),
    [selectedKeys, tasksByKey],
  );

  const applyStatusToSelection = useCallback(
    async (status: TaskStatus) => {
      if (selectedTasks.length === 0) return false;
      const changed = selectedTasks.some((task) => task.status !== status);

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
        return false;
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
        return false;
      }

      return changed;
    },
    [selectedTasks, setStatus],
  );

  const applyPriorityToSelection = useCallback(
    async (priority: TaskPriority) => {
      if (selectedTasks.length === 0) return false;
      const changed = selectedTasks.some((task) => task.priority !== priority);

      let firstError: string | null = null;
      for (const task of selectedTasks) {
        const result = await setPriority(task.sourceFile, task.id, priority);
        if (result.status === "error" && firstError === null) {
          firstError = result.message;
        }
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
        return false;
      }

      return changed;
    },
    [selectedTasks, setPriority],
  );

  const applyDueDateToSelection = useCallback(
    async (dueDate: string | null) => {
      if (selectedTasks.length === 0) return false;
      const changed = selectedTasks.some((task) => task.dueDate !== dueDate);

      let firstError: string | null = null;
      for (const task of selectedTasks) {
        const result = await setDueDate(task.sourceFile, task.id, dueDate);
        if (result.status === "error" && firstError === null) {
          firstError = result.message;
        }
      }

      if (firstError !== null) {
        await showMessage("Task Update Failed", firstError);
        return false;
      }

      return changed;
    },
    [selectedTasks, setDueDate],
  );

  const handler = useCallback(
    async (e: KeyboardEvent) => {
      // Defer to any handler (a modal/menu, or the zoom handler) that already
      // consumed this key, and never act on keys originating inside an overlay.
      if (e.defaultPrevented) return;
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
        if (selectedKeys.size === 0) return;
        e.preventDefault();
        onMoveTasks();
        return;
      }

      // --- Primary modifier + Shift + N: Focus the new note field.
      // Normalize the letter match so shifted shortcuts do not depend on
      // whether the underlying webview reports "n" or "N".
      if (mod && e.shiftKey && matchesShortcutKey(e, "n")) {
        if (selectedKeys.size !== 1) return;
        e.preventDefault();
        onFocusNewNote();
        return;
      }

      // --- Primary modifier + , : Open Settings ---
      if (isOpenSettingsShortcut(e)) {
        e.preventDefault();
        onOpenSettings();
        return;
      }

      // --- Primary modifier + / (or a bare ?): Open keyboard-shortcuts help ---
      if (isOpenShortcutsHelpShortcut(e)) {
        // A bare "?" is printable, so don't hijack it while typing in a field.
        // The Cmd+/ form carries a modifier and may fire anywhere, like Cmd+N.
        if (e.key === "?" && isTyping(e)) return;
        e.preventDefault();
        onOpenShortcutsHelp();
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
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyStatusToSelection("Pending")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (matchesShortcutKey(e, "c")) {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyStatusToSelection("Completed")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (matchesShortcutKey(e, "x")) {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyStatusToSelection("Dismissed")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (e.key === "0") {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyPriorityToSelection("Default")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (e.key === "1") {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyPriorityToSelection("Urgent")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (e.key === "2") {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyPriorityToSelection("Important")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (e.key === "3") {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyPriorityToSelection("Critical")) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        // D = toDay, T = Tomorrow. Dropkick takes Space alone (see below).
        if (matchesShortcutKey(e, "d")) {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyDueDateToSelection(todayInTimezone(timezone))) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (matchesShortcutKey(e, "t")) {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyDueDateToSelection(tomorrowInTimezone(timezone))) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }

        if (matchesShortcutKey(e, "n")) {
          e.preventDefault();
          const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
          if (await applyDueDateToSelection(null)) {
            setSelection(nextKey ? new Set([nextKey]) : new Set());
          }
          return;
        }
      }

      // --- Space: Dropkick the selection (the app's primary action) ---
      // Space is the Dropkick key, so it must never page-scroll the list. Block
      // its default whenever it isn't typing or activating a focused control;
      // then, in a single-list view with a selection, dropkick. It stays a
      // no-op in unified view (Dropkick is a single-file reorder, like the
      // Reorder buttons) and when nothing is selected — but the scroll is still
      // swallowed in both cases.
      if (
        e.key === " " &&
        !e.repeat &&
        !hasNonShiftModifier &&
        !e.shiftKey &&
        !consumesSpace(e.target as HTMLElement | null)
      ) {
        e.preventDefault();
        if (isUnifiedView) {
          useToastStore.getState().showToast(UNIFIED_DROPKICK_MSG);
          return;
        }
        if (selectedTasks.length === 0) return;
        const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
        const result = await dropkick(filePath);
        if (result.status === "error") {
          await showMessage("Task Reorder Failed", result.message);
          return;
        }
        // Advance only when the reorder actually moved something (the store
        // reports it), not on a no-op dropkick of an already-bottom task.
        if (result.status === "success" && result.changed) {
          setSelection(nextKey ? new Set([nextKey]) : new Set());
        }
        return;
      }

      // --- Delete/Backspace: Dismiss selected tasks ---
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isTyping(e)) return;
        if (selectedTasks.length === 0) return;
        e.preventDefault();
        const nextKey = pickNextActiveKey(selectedKeys, visualTasks);
        const confirmed = await showConfirm(
          "Dismiss Tasks",
          `Dismiss ${selectedTasks.length} selected task(s)?`,
        );
        if (!confirmed) return;
        let firstError: string | null = null;
        for (const task of selectedTasks) {
          const result = await setStatus(task.sourceFile, task.id, "Dismissed");
          if (result.status === "error" && firstError === null) {
            firstError = result.message;
          }
        }
        if (firstError !== null) {
          await showMessage("Task Update Failed", firstError);
          return;
        }
        setSelection(nextKey ? new Set([nextKey]) : new Set());
        return;
      }

      // --- Primary modifier + Up: Move selection up one position ---
      if (mod && !e.shiftKey && e.key === "ArrowUp") {
        if (isTyping(e) || selectedKeys.size === 0) return;
        e.preventDefault();
        if (isUnifiedView) {
          useToastStore.getState().showToast(UNIFIED_REORDER_MSG);
          return;
        }
        const result = await moveUp(filePath);
        if (result.status === "error") {
          await showMessage("Task Reorder Failed", result.message);
        }
        return;
      }

      // --- Primary modifier + Down: Move selection down one position ---
      if (mod && !e.shiftKey && e.key === "ArrowDown") {
        if (isTyping(e) || selectedKeys.size === 0) return;
        e.preventDefault();
        if (isUnifiedView) {
          useToastStore.getState().showToast(UNIFIED_REORDER_MSG);
          return;
        }
        const result = await moveDown(filePath);
        if (result.status === "error") {
          await showMessage("Task Reorder Failed", result.message);
        }
        return;
      }

      // --- Primary modifier + Home: Send to first in group (Tackle) ---
      if (mod && e.key === "Home") {
        if (isTyping(e) || selectedKeys.size === 0) return;
        e.preventDefault();
        if (isUnifiedView) {
          useToastStore.getState().showToast(UNIFIED_REORDER_MSG);
          return;
        }
        const result = await sendToFirst(filePath);
        if (result.status === "error") {
          await showMessage("Task Reorder Failed", result.message);
        }
        return;
      }

      // --- Primary modifier + End: Send to last in group (Kick) ---
      if (mod && e.key === "End") {
        if (isTyping(e) || selectedKeys.size === 0) return;
        e.preventDefault();
        if (isUnifiedView) {
          useToastStore.getState().showToast(UNIFIED_REORDER_MSG);
          return;
        }
        const result = await sendToLast(filePath);
        if (result.status === "error") {
          await showMessage("Task Reorder Failed", result.message);
        }
        return;
      }

      // Plain ArrowUp/ArrowDown navigation lives in the task list itself
      // (TaskListPane's listbox onKeyDown), so it fires only when the list has
      // focus — never while focus is in the detail pane. Cmd+Arrow (reorder) is
      // still handled above as a global command.

      // --- Ctrl+Tab / Ctrl+Shift+Tab: Cycle tabs (literal Ctrl on every
      // platform — see tabCycleDirection; macOS reserves Cmd+Tab) ---
      const cycle = tabCycleDirection(e);
      if (cycle !== null) {
        e.preventDefault();
        const tabs = workspace.openTabs;
        if (tabs.length <= 1) return;
        const current = workspace.activeTabIndex;
        const next = (current + cycle + tabs.length) % tabs.length;
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
        if (selectedKeys.size > 0) {
          e.preventDefault();
          setSelection(new Set());
        }
        return;
      }
    },
    [
      filePath,
      isUnifiedView,
      selectedKeys,
      selectedTasks,
      tasksByKey,
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
      onOpenSettings,
      onOpenShortcutsHelp,
      setStatus,
      setPriority,
      setDueDate,
      moveUp,
      moveDown,
      sendToFirst,
      sendToLast,
      dropkick,
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
