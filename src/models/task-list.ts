// Task list stored as a JSON file at any path (typically in a project repo root).
// Contains an ordered array of tasks. Array position = display order.

import { generateId } from "../utils/ids";

export type TaskStatus = "Pending" | "Completed" | "Dismissed";

export type TaskPriority = "Critical" | "Urgent" | "Important" | "Default";

export type NoteActionability = "Informational" | "Actionable" | "Resolved";

export interface NoteDto {
  id: string;
  content: string;
  actionability: NoteActionability;
  createdAtUtc: string; // ISO 8601
  // ISO 8601, the moment of the last content edit; absent until the note is
  // first edited.
  editedAtUtc?: string;
}

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null; // date only "YYYY-MM-DD", no timezone
  createdAtUtc: string; // ISO 8601
  updatedAtUtc: string; // ISO 8601
  completedAtUtc: string | null; // ISO 8601, the handled time: set on leaving Pending, kept between Completed and Dismissed
  notes: NoteDto[];
}

export interface TaskListDto {
  // Stable identity for this list, generated once at creation.
  id: string;
  tasks: TaskDto[];
}

export function createEmptyTaskList(): TaskListDto {
  return {
    id: generateId(),
    tasks: [],
  };
}
