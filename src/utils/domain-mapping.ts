import type { TaskDto } from "../models";
import type { Task, TaskGroup } from "../models";
import { isOverdue, isDueWithinDays } from "./dates";

// Computes the display group for a task based on priority and due date.
// Each task belongs to exactly one group — the highest applicable one.
function computeGroup(
  dto: TaskDto,
  timezone: string | null,
): TaskGroup {
  const hasDue = dto.dueDate !== null;

  // Past due takes top priority.
  if (hasDue && isOverdue(dto.dueDate!, timezone)) {
    return "PastDue";
  }

  // Critical is next, regardless of due date.
  if (dto.priority === "Critical") {
    return "Critical";
  }

  // Due within 7 days elevates any remaining task.
  if (hasDue && isDueWithinDays(dto.dueDate!, 7, timezone)) {
    return "DueWithinWeek";
  }

  // Then standard priority cascade.
  if (dto.priority === "Urgent") return "Urgent";
  if (dto.priority === "Important") return "Important";
  return "Default";
}

// Converts a DTO from JSON into a domain model with computed properties.
export function toTask(
  dto: TaskDto,
  sourceFile: string,
  timezone: string | null,
): Task {
  const hasActionableNotes = dto.notes.some(
    (n) => n.actionability === "Actionable",
  );

  return {
    ...dto,
    hasActionableNotes,
    canComplete: !hasActionableNotes,
    isOverdue: dto.dueDate !== null && isOverdue(dto.dueDate, timezone),
    isDueWithinWeek:
      dto.dueDate !== null && isDueWithinDays(dto.dueDate, 7, timezone),
    group: computeGroup(dto, timezone),
    sourceFile,
  };
}

// Strips computed properties, returning a clean DTO for serialization.
// Preserves the original key order by explicitly constructing the object.
export function toDto(task: Task): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    createdAtUtc: task.createdAtUtc,
    updatedAtUtc: task.updatedAtUtc,
    completedAtUtc: task.completedAtUtc,
    notes: task.notes,
  };
}
