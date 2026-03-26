// Task list stored as a JSON file at any path (typically in a project repo root).
// Contains an ordered array of tasks. Array position = display order.

export type TaskStatus = "Pending" | "Completed" | "Dismissed";

export type TaskPriority = "Critical" | "Urgent" | "Important" | "Default";

export type NoteFormat = "plaintext" | "markdown";

export type NoteActionability = "Informational" | "Actionable" | "Resolved";

export interface NoteDto {
  id: string;
  content: string;
  format: NoteFormat;
  actionability: NoteActionability;
  createdAtUtc: string; // ISO 8601
}

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  descriptionFormat: NoteFormat;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null; // date only "YYYY-MM-DD", no timezone
  createdAtUtc: string; // ISO 8601
  updatedAtUtc: string; // ISO 8601
  completedAtUtc: string | null; // ISO 8601, set on Completed or Dismissed
  notes: NoteDto[];
}

export interface TaskListDto {
  version: string;
  tasks: TaskDto[];
}

export function createEmptyTaskList(): TaskListDto {
  return {
    version: "1.0.0",
    tasks: [],
  };
}
