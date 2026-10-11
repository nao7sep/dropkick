import type { TaskDto } from "../models";
import type { Task, TaskGroup } from "../models";
import { todayInTimezone } from "./dates";
import { addDays, format, parseISO } from "date-fns";

export interface TaskCalendar { today: string; dueSoonEnd: string }
export function taskCalendar(timezone: string, dueSoonDays: number, today = todayInTimezone(timezone)): TaskCalendar {
  return { today, dueSoonEnd: format(addDays(parseISO(today), dueSoonDays), "yyyy-MM-dd") };
}

// Computes the display group for a task based on priority and due date.
// Each task belongs to exactly one group — the highest applicable one.
export function computeGroup(
  dto: TaskDto,
  timezone: string,
  dueSoonDays: number,
  calendar = taskCalendar(timezone, dueSoonDays),
): TaskGroup {
  const hasDue = dto.dueDate !== null;

  // Past due takes top priority.
  if (hasDue && dto.dueDate! < calendar.today) {
    return "PastDue";
  }

  // Critical is next, regardless of due date.
  if (dto.priority === "Critical") {
    return "Critical";
  }

  // Due today takes priority over explicit priority flags (except Critical above).
  if (hasDue && dto.dueDate === calendar.today) {
    return "DueToday";
  }

  // Explicit priority cascade: Important and Urgent outrank the lookahead window.
  if (dto.priority === "Important") return "Important";
  if (dto.priority === "Urgent") return "Urgent";

  // Due soon: elevates Default-priority tasks with an imminent due date.
  if (hasDue && dto.dueDate! > calendar.today && dto.dueDate! <= calendar.dueSoonEnd) {
    return "DueSoon";
  }
  return "Default";
}

// Converts a DTO from JSON into a domain model with computed properties.
export function toTask(
  dto: TaskDto,
  sourceFile: string,
  timezone: string,
  dueSoonDays: number,
  calendar = taskCalendar(timezone, dueSoonDays),
): Task {
  const hasActionableNotes = dto.notes.some(
    (n) => n.actionability === "Actionable",
  );

  return {
    ...dto,
    hasActionableNotes,
    canComplete: !hasActionableNotes,
    isOverdue: dto.dueDate !== null && dto.dueDate < calendar.today,
    isDueToday:
      dto.dueDate !== null && dto.dueDate === calendar.today,
    group: computeGroup(dto, timezone, dueSoonDays, calendar),
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
