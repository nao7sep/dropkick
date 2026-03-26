import type { TaskDto, NoteDto } from "../models";
import { generateId } from "./ids";
import { nowUtc } from "./dates";

// Creates a new task with consistent key order.
// New tasks are Pending, Default priority, no due date, plaintext description.
export function createTask(title: string): TaskDto {
  const now = nowUtc();
  return {
    id: generateId(),
    title,
    description: "",
    descriptionFormat: "plaintext",
    status: "Pending",
    priority: "Default",
    dueDate: null,
    createdAtUtc: now,
    updatedAtUtc: now,
    completedAtUtc: null,
    notes: [],
  };
}

// Creates a new note with consistent key order.
// New notes are Informational and plaintext by default.
export function createNote(content: string): NoteDto {
  return {
    id: generateId(),
    content,
    format: "plaintext",
    actionability: "Informational",
    createdAtUtc: nowUtc(),
  };
}
