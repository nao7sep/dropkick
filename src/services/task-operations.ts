// Task-level operations: add, update, status transitions.
// All functions return new arrays/objects — no mutation.
// updatedAtUtc, and a note's editedAtUtc, follow the Modified rule of the
// content-lifecycle-conventions; status and note actionability are lifecycle.
// No-op edits must return the original task object so callers can skip writes.

import type { TaskDto, TaskStatus, TaskPriority, NoteDto, NoteActionability } from "../models";
import { nowUtc } from "../utils";

// Adds a new task to the beginning of the task list.
export function addTask(tasks: TaskDto[], task: TaskDto): TaskDto[] {
  return [task, ...tasks];
}

// Updates a task's title.
export function updateTaskTitle(
  task: TaskDto,
  title: string,
): TaskDto {
  if (task.title === title) return task;
  return { ...task, title, updatedAtUtc: nowUtc() };
}

// Updates a task's description.
export function updateTaskDescription(
  task: TaskDto,
  description: string,
): TaskDto {
  if (task.description === description) return task;
  return { ...task, description, updatedAtUtc: nowUtc() };
}

// Changes a task's status. Completed and Dismissed share one handled time,
// completedAtUtc: entering either from Pending sets it, moving between them
// keeps it, and returning to Pending clears it.
// Caller is responsible for validation (use canTransitionStatus first).
export function changeTaskStatus(
  task: TaskDto,
  status: TaskStatus,
): TaskDto {
  if (task.status === status) return task;
  if (status === "Pending") return { ...task, status, completedAtUtc: null };
  if (task.status !== "Pending") return { ...task, status };
  return { ...task, status, completedAtUtc: nowUtc() };
}

// Changes a task's priority.
export function changeTaskPriority(
  task: TaskDto,
  priority: TaskPriority,
): TaskDto {
  if (task.priority === priority) return task;
  return { ...task, priority, updatedAtUtc: nowUtc() };
}

// Sets or clears a task's due date.
export function changeTaskDueDate(
  task: TaskDto,
  dueDate: string | null,
): TaskDto {
  if (task.dueDate === dueDate) return task;
  return { ...task, dueDate, updatedAtUtc: nowUtc() };
}

// Adds a note to the beginning of a task's notes array (newest first).
export function addNote(task: TaskDto, note: NoteDto): TaskDto {
  return {
    ...task,
    notes: [note, ...task.notes],
    updatedAtUtc: nowUtc(),
  };
}

// Updates a note's content. The note records the edit's moment as its own
// editedAtUtc, and the task's updatedAtUtc takes the same moment.
export function updateNoteContent(
  task: TaskDto,
  noteId: string,
  content: string,
): TaskDto {
  const note = task.notes.find((n) => n.id === noteId);
  if (!note || note.content === content) return task;

  const now = nowUtc();
  return {
    ...task,
    notes: task.notes.map((n) =>
      n.id === noteId ? { ...n, content, editedAtUtc: now } : n,
    ),
    updatedAtUtc: now,
  };
}

// Changes a note's actionability state.
export function changeNoteActionability(
  task: TaskDto,
  noteId: string,
  actionability: NoteActionability,
): TaskDto {
  const note = task.notes.find((n) => n.id === noteId);
  if (!note || note.actionability === actionability) return task;

  return {
    ...task,
    notes: task.notes.map((n) =>
      n.id === noteId ? { ...n, actionability } : n,
    ),
  };
}

// Removes tasks from the array by ID.
export function deleteTasks(
  tasks: TaskDto[],
  taskIds: ReadonlySet<string>,
): TaskDto[] {
  if (!tasks.some((task) => taskIds.has(task.id))) return tasks;
  return tasks.filter((task) => !taskIds.has(task.id));
}

// Removes a note from a task by note ID.
export function deleteNote(
  task: TaskDto,
  noteId: string,
): TaskDto {
  if (!task.notes.some((n) => n.id === noteId)) return task;

  return {
    ...task,
    notes: task.notes.filter((n) => n.id !== noteId),
    updatedAtUtc: nowUtc(),
  };
}

// Replaces a task in the array by ID with an updated version.
export function replaceTask(
  tasks: TaskDto[],
  updatedTask: TaskDto,
): TaskDto[] {
  const index = tasks.findIndex((t) => t.id === updatedTask.id);
  if (index === -1) return tasks;
  if (tasks[index] === updatedTask) return tasks;

  return tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
}
