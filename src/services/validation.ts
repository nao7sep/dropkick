// Validation rules for task state transitions.

import type { TaskDto, TaskStatus } from "../models";

export interface ValidationResult {
  valid: boolean;
  reason: string | null;
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
        reason: `Cannot complete: ${actionableCount} actionable note${actionableCount > 1 ? "s" : ""} remaining`,
      };
    }
  }

  return { valid: true, reason: null };
}
