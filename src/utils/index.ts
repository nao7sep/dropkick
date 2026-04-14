export { generateId } from "./ids";

export {
  nowUtc,
  todayInTimezone,
  tomorrowInTimezone,
  formatTimestamp,
  formatDueDate,
  isOverdue,
  isDueWithinDays,
} from "./dates";

export { createTask, createNote } from "./factories";
export type { CreateTaskOptions } from "./factories";

export { computeGroup, toTask, toDto } from "./domain-mapping";

export { sanitizeSingleLine } from "./sanitize";
export {
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
} from "./shortcuts";
