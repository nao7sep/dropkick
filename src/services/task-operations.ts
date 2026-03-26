// Task-level operations: add, update, status transitions.
// All functions return new arrays/objects — no mutation.

import type { TaskDto, TaskStatus, TaskPriority, NoteDto } from "../models";
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
  return { ...task, title, updatedAtUtc: nowUtc() };
}

// Updates a task's description and format.
export function updateTaskDescription(
  task: TaskDto,
  description: string,
  descriptionFormat: "plaintext" | "markdown",
): TaskDto {
  return { ...task, description, descriptionFormat, updatedAtUtc: nowUtc() };
}

// Changes a task's status. Sets completedAtUtc when transitioning to Completed/Dismissed.
// Clears completedAtUtc when returning to Pending.
// Caller is responsible for validation (use canTransitionStatus first).
export function changeTaskStatus(
  task: TaskDto,
  status: TaskStatus,
): TaskDto {
  const now = nowUtc();

  if (status === "Completed" || status === "Dismissed") {
    return { ...task, status, completedAtUtc: now, updatedAtUtc: now };
  }

  // Returning to Pending.
  return { ...task, status, completedAtUtc: null, updatedAtUtc: now };
}

// Changes a task's priority.
export function changeTaskPriority(
  task: TaskDto,
  priority: TaskPriority,
): TaskDto {
  return { ...task, priority, updatedAtUtc: nowUtc() };
}

// Sets or clears a task's due date.
export function changeTaskDueDate(
  task: TaskDto,
  dueDate: string | null,
): TaskDto {
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

// Updates a note's content and format.
export function updateNoteContent(
  task: TaskDto,
  noteId: string,
  content: string,
  format: "plaintext" | "markdown",
): TaskDto {
  return {
    ...task,
    notes: task.notes.map((n) =>
      n.id === noteId ? { ...n, content, format } : n,
    ),
    updatedAtUtc: nowUtc(),
  };
}

// Changes a note's actionability state.
export function changeNoteActionability(
  task: TaskDto,
  noteId: string,
  actionability: "Informational" | "Actionable" | "Resolved",
): TaskDto {
  return {
    ...task,
    notes: task.notes.map((n) =>
      n.id === noteId ? { ...n, actionability } : n,
    ),
    updatedAtUtc: nowUtc(),
  };
}

// Replaces a task in the array by ID with an updated version.
export function replaceTask(
  tasks: TaskDto[],
  updatedTask: TaskDto,
): TaskDto[] {
  return tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
}
