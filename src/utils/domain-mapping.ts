import type { TaskDto } from "../models";
import type { Task, TaskGroup } from "../models";
import { isOverdue, isDueInDayRange } from "./dates";

// Computes the display group for a task based on priority and due date.
// Each task belongs to exactly one group — the highest applicable one.
export function computeGroup(
  dto: TaskDto,
  timezone: string | null,
  dueSoonDays: number,
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

  // Due today takes priority over explicit priority flags (except Critical above).
  if (hasDue && isDueInDayRange(dto.dueDate!, 0, 1, timezone)) {
    return "DueToday";
  }

  // Explicit priority cascade: Important and Urgent outrank the lookahead window.
  if (dto.priority === "Important") return "Important";
  if (dto.priority === "Urgent") return "Urgent";

  // Due soon: elevates Default-priority tasks with an imminent due date.
  if (hasDue && isDueInDayRange(dto.dueDate!, 1, dueSoonDays, timezone)) {
    return "DueSoon";
  }
  return "Default";
}

// Converts a DTO from JSON into a domain model with computed properties.
export function toTask(
  dto: TaskDto,
  sourceFile: string,
  timezone: string | null,
  dueSoonDays: number,
): Task {
  const hasActionableNotes = dto.notes.some(
    (n) => n.actionability === "Actionable",
  );

  return {
    ...dto,
    hasActionableNotes,
    canComplete: !hasActionableNotes,
    isOverdue: dto.dueDate !== null && isOverdue(dto.dueDate, timezone),
    isDueToday:
      dto.dueDate !== null && isDueInDayRange(dto.dueDate, 0, 1, timezone),
    group: computeGroup(dto, timezone, dueSoonDays),
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
