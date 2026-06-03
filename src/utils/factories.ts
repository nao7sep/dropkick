import type { TaskDto, TaskPriority, NoteDto, NoteActionability } from "../models";
import { generateId } from "./ids";
import { nowUtc } from "./dates";

export interface CreateTaskOptions {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
}

// Creates a new task with consistent key order.
// New tasks are Pending, Default priority, no due date by default.
export function createTask(options: CreateTaskOptions): TaskDto {
  const now = nowUtc();
  return {
    id: generateId(),
    title: options.title,
    description: options.description ?? "",
    status: "Pending",
    priority: options.priority ?? "Default",
    dueDate: options.dueDate ?? null,
    createdAtUtc: now,
    updatedAtUtc: now,
    completedAtUtc: null,
    notes: [],
  };
}

// Creates a new note with consistent key order.
// New notes are Informational and plaintext by default.
export function createNote(
  content: string,
  actionability: NoteActionability = "Informational",
): NoteDto {
  return {
    id: generateId(),
    content,
    actionability,
    createdAtUtc: nowUtc(),
  };
}
