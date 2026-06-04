import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTask, createNote } from "../../src/utils/factories";

const FIXED_NOW = "2026-06-04T12:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTask", () => {
  it("applies Pending / Default / no-due defaults", () => {
    const task = createTask({ title: "Buy milk" });
    expect(task.title).toBe("Buy milk");
    expect(task.status).toBe("Pending");
    expect(task.priority).toBe("Default");
    expect(task.dueDate).toBeNull();
    expect(task.description).toBe("");
    expect(task.notes).toEqual([]);
  });

  it("stamps createdAtUtc and updatedAtUtc with the current time and no completion", () => {
    const task = createTask({ title: "x" });
    expect(task.createdAtUtc).toBe(FIXED_NOW);
    expect(task.updatedAtUtc).toBe(FIXED_NOW);
    expect(task.completedAtUtc).toBeNull();
  });

  it("honors provided priority and due date", () => {
    const task = createTask({ title: "x", priority: "Critical", dueDate: "2026-12-31" });
    expect(task.priority).toBe("Critical");
    expect(task.dueDate).toBe("2026-12-31");
  });

  it("generates a non-empty id", () => {
    expect(createTask({ title: "x" }).id.length).toBeGreaterThan(0);
  });

  it("generates distinct ids for separate tasks", () => {
    expect(createTask({ title: "a" }).id).not.toBe(createTask({ title: "b" }).id);
  });

  it("produces DTO keys in the canonical order", () => {
    expect(Object.keys(createTask({ title: "x" }))).toEqual([
      "id",
      "title",
      "description",
      "status",
      "priority",
      "dueDate",
      "createdAtUtc",
      "updatedAtUtc",
      "completedAtUtc",
      "notes",
    ]);
  });
});

describe("createNote", () => {
  it("defaults to Informational", () => {
    const note = createNote("hello");
    expect(note.content).toBe("hello");
    expect(note.actionability).toBe("Informational");
    expect(note.createdAtUtc).toBe(FIXED_NOW);
  });

  it("honors an explicit actionability", () => {
    expect(createNote("x", "Actionable").actionability).toBe("Actionable");
  });
});
