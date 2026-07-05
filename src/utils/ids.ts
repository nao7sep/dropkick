import { nanoid } from "nanoid";

// Generates a unique ID. Used for dropkick entities (tasks, notes, task lists).
// 21 characters by default — collision-resistant and URL-safe.
export function generateId(): string {
  return nanoid();
}
