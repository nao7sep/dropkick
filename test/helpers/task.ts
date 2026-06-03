// Test fixtures for building TaskDto / NoteDto without repeating every field.

import type { NoteDto, TaskDto } from "../../src/models";

let seq = 0;

// Builds a Pending, Default-priority task. Override any field via `overrides`.
// IDs auto-increment per test process so tasks are distinguishable by default.
export function makeTask(overrides: Partial<TaskDto> = {}): TaskDto {
  seq += 1;
  const id = overrides.id ?? `t${seq}`;
  return {
    id,
    title: overrides.title ?? `Task ${id}`,
    description: overrides.description ?? "",
    status: overrides.status ?? "Pending",
    priority: overrides.priority ?? "Default",
    dueDate: overrides.dueDate ?? null,
    createdAtUtc: overrides.createdAtUtc ?? "2026-01-01T00:00:00.000Z",
    updatedAtUtc: overrides.updatedAtUtc ?? "2026-01-01T00:00:00.000Z",
    completedAtUtc: overrides.completedAtUtc ?? null,
    notes: overrides.notes ?? [],
  };
}

export function makeNote(overrides: Partial<NoteDto> = {}): NoteDto {
  seq += 1;
  const id = overrides.id ?? `n${seq}`;
  return {
    id,
    content: overrides.content ?? "note",
    actionability: overrides.actionability ?? "Informational",
    createdAtUtc: overrides.createdAtUtc ?? "2026-01-01T00:00:00.000Z",
  };
}

// Convenience: the set of ids the kick/move/operations functions expect.
export function ids(...values: string[]): Set<string> {
  return new Set(values);
}
