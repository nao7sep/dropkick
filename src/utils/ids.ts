import { nanoid } from "nanoid";

// Generates a unique ID for tasks and notes.
// 21 characters by default — collision-resistant and URL-safe.
export function generateId(): string {
  return nanoid();
}
