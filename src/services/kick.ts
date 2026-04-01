// Kick and reorder operations — all group-aware, slot-based.
//
// The flat task array stores tasks in user-defined order. Groups are a VIEW
// over that order — each group's tasks occupy certain "slots" (indices) in the
// array. Reordering within a group shuffles which task goes into which slot,
// but the slots themselves don't move. Tasks in other groups are never touched.
//
// Only dropkick changes a task's group (by modifying attributes).

import type { TaskDto, TaskGroup } from "../models";
import { computeGroup } from "../utils";
import { nowUtc } from "../utils";

function arraysShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// --- Core helper ---

// Returns the array indices where tasks of the given group sit,
// considering only Pending tasks.
function groupSlots(
  tasks: TaskDto[],
  group: TaskGroup,
  timezone: string | null,
): number[] {
  const slots: number[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.status === "Pending" && computeGroup(t, timezone) === group) {
      slots.push(i);
    }
  }
  return slots;
}

// Applies a reorder function to each group that has selected tasks.
// Only touches the slots belonging to affected groups.
function reorderWithinGroups(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
  reorderFn: (groupTasks: TaskDto[], selected: Set<string>) => TaskDto[],
): TaskDto[] {
  // Find which groups have selected tasks.
  const affectedGroups = new Set<TaskGroup>();
  for (const t of tasks) {
    if (selectedIds.has(t.id) && t.status === "Pending") {
      affectedGroups.add(computeGroup(t, timezone));
    }
  }

  if (affectedGroups.size === 0) return tasks;

  const result = [...tasks];

  for (const group of affectedGroups) {
    const slots = groupSlots(result, group, timezone);
    const groupTasks = slots.map((i) => result[i]);

    const selectedInGroup = new Set(
      groupTasks.filter((t) => selectedIds.has(t.id)).map((t) => t.id),
    );

    const reordered = reorderFn(groupTasks, selectedInGroup);

    // Put reordered tasks back into the same slots.
    for (let j = 0; j < slots.length; j++) {
      result[slots[j]] = reordered[j];
    }
  }

  return arraysShallowEqual(result, tasks) ? tasks : result;
}

// --- Public operations ---

// Tackle: send selected tasks to first within their group.
export function sendTasksToFirst(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
): TaskDto[] {
  return reorderWithinGroups(tasks, selectedIds, timezone, (groupTasks, selected) => {
    const sel: TaskDto[] = [];
    const rest: TaskDto[] = [];
    for (const t of groupTasks) {
      if (selected.has(t.id)) sel.push(t);
      else rest.push(t);
    }
    return [...sel, ...rest];
  });
}

// Kick: send selected tasks to last within their group.
export function sendTasksToLast(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
): TaskDto[] {
  return reorderWithinGroups(tasks, selectedIds, timezone, (groupTasks, selected) => {
    const sel: TaskDto[] = [];
    const rest: TaskDto[] = [];
    for (const t of groupTasks) {
      if (selected.has(t.id)) sel.push(t);
      else rest.push(t);
    }
    return [...rest, ...sel];
  });
}

// Kick by distance: move selected tasks down N positions within their group.
export function kickTasks(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  distance: number,
  timezone: string | null,
): TaskDto[] {
  return reorderWithinGroups(tasks, selectedIds, timezone, (groupTasks, selected) => {
    const sel: TaskDto[] = [];
    const rest: TaskDto[] = [];
    for (const t of groupTasks) {
      if (selected.has(t.id)) sel.push(t);
      else rest.push(t);
    }
    if (sel.length === 0) return groupTasks;

    const firstIdx = groupTasks.findIndex((t) => selected.has(t.id));
    const insertAfter = Math.min(firstIdx + distance, rest.length);

    return [
      ...rest.slice(0, insertAfter),
      ...sel,
      ...rest.slice(insertAfter),
    ];
  });
}

// Move selected tasks up by one position within their group.
export function moveTasksUp(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
): TaskDto[] {
  return reorderWithinGroups(tasks, selectedIds, timezone, (groupTasks, selected) => {
    const result = [...groupTasks];
    for (let i = 0; i < result.length; i++) {
      if (selected.has(result[i].id) && i > 0 && !selected.has(result[i - 1].id)) {
        [result[i - 1], result[i]] = [result[i], result[i - 1]];
      }
    }
    return result;
  });
}

// Move selected tasks down by one position within their group.
export function moveTasksDown(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
): TaskDto[] {
  return reorderWithinGroups(tasks, selectedIds, timezone, (groupTasks, selected) => {
    const result = [...groupTasks];
    for (let i = result.length - 1; i >= 0; i--) {
      if (selected.has(result[i].id) && i < result.length - 1 && !selected.has(result[i + 1].id)) {
        [result[i], result[i + 1]] = [result[i + 1], result[i]];
      }
    }
    return result;
  });
}

// Dropkick: reset priority to Default, clear due date, then send to last in Default group.
// This is the only operation that changes task attributes and group membership.
export function dropkickTasks(
  tasks: TaskDto[],
  selectedIds: Set<string>,
  timezone: string | null,
): TaskDto[] {
  const now = nowUtc();
  const result = [...tasks];

  // Collect tasks to dropkick and their current indices.
  const toDropkick: { index: number; task: TaskDto }[] = [];
  for (let i = 0; i < result.length; i++) {
    if (selectedIds.has(result[i].id) && result[i].status === "Pending") {
      toDropkick.push({ index: i, task: result[i] });
    }
  }

  if (toDropkick.length === 0) return tasks;

  // Remove them from the array (in reverse to preserve indices).
  for (let i = toDropkick.length - 1; i >= 0; i--) {
    result.splice(toDropkick[i].index, 1);
  }

  // Modify their attributes.
  const modified = toDropkick.map((item) => {
    const needsFieldChange =
      item.task.priority !== "Default" || item.task.dueDate !== null;

    if (!needsFieldChange) return item.task;

    return {
      ...item.task,
      priority: "Default" as const,
      dueDate: null,
      updatedAtUtc: now,
    };
  });

  // Find the insertion point: after the last Default-group pending task.
  // If no Default tasks exist, insert after the last pending task.
  let insertAt = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].status === "Pending" && computeGroup(result[i], timezone) === "Default") {
      insertAt = i + 1;
      break;
    }
  }

  if (insertAt === -1) {
    // No Default pending tasks. Insert after last pending task.
    insertAt = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i].status === "Pending") {
        insertAt = i + 1;
      }
    }
  }

  // Insert the dropkicked tasks.
  result.splice(insertAt, 0, ...modified);

  return arraysShallowEqual(result, tasks) ? tasks : result;
}
