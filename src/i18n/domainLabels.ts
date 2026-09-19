import type { NoteActionability, TaskPriority, TaskStatus } from "../models";
import type { MessageKey } from "./catalogues";

// Display text for the values task lists store. The stored values stay the
// English words they are in every file; only what the interface shows is
// translated.
export const PRIORITY_LABELS: Readonly<Record<TaskPriority, MessageKey>> = {
  Default: "priority.default",
  Urgent: "priority.urgent",
  Important: "priority.important",
  Critical: "priority.critical",
};

export const STATUS_LABELS: Readonly<Record<TaskStatus, MessageKey>> = {
  Pending: "status.pending",
  Completed: "status.completed",
  Dismissed: "status.dismissed",
};

export const ACTIONABILITY_LABELS: Readonly<Record<NoteActionability, MessageKey>> = {
  Informational: "actionability.informational",
  Actionable: "actionability.actionable",
  Resolved: "actionability.resolved",
};
