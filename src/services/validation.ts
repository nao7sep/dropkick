// Validation rules for task state transitions.

import type { TaskDto, TaskStatus } from "../models";
import { message, type Message } from "../i18n/translate";

export interface ValidationResult {
  valid: boolean;
  reason: Message | null;
}

// Checks whether a task can transition to the given status.
// A task cannot be Completed if it has any Actionable notes.
// A task can always be Dismissed (abandons all work).
// A task can always return to Pending.
export function canTransitionStatus(
  task: TaskDto,
  newStatus: TaskStatus,
): ValidationResult {
  if (newStatus === "Completed") {
    const actionableCount = task.notes.filter(
      (n) => n.actionability === "Actionable",
    ).length;

    if (actionableCount > 0) {
      return {
        valid: false,
        reason: message("task.cannotComplete", { count: actionableCount }),
      };
    }
  }

  return { valid: true, reason: null };
}
