import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  addTask,
  updateTaskTitle,
  updateTaskDescription,
  changeTaskStatus,
  changeTaskPriority,
  changeTaskDueDate,
  addNote,
  updateNoteContent,
  changeNoteActionability,
  deleteTasks,
  deleteNote,
  replaceTask,
} from "../../src/services/task-operations";
import { makeTask, makeNote } from "../helpers/task";

// The load-bearing contract here: an edit that changes nothing returns the SAME
// object reference, and updatedAtUtc follows the Modified rule of the
// content-lifecycle-conventions: content edits move it, lifecycle does not.
// Callers rely on reference identity to skip disk writes.

const FIXED_NOW = "2026-06-04T12:00:00.000Z";
const EARLIER = "2026-01-01T00:00:00.000Z";
const HANDLED = "2026-03-01T00:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addTask / deleteTasks / replaceTask", () => {
  it("addTask prepends to the list", () => {
    const tasks = [makeTask({ id: "a" })];
    const result = addTask(tasks, makeTask({ id: "b" }));
    expect(result.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("deleteTasks removes every requested id", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    expect(deleteTasks(tasks, new Set(["a", "b"]))).toEqual([]);
  });

  it("deleteTasks returns the same array when no id is present", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(deleteTasks(tasks, new Set(["missing"]))).toBe(tasks);
  });

  it("replaceTask swaps the matching task in place", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];
    const updated = { ...tasks[1], title: "changed" };
    const result = replaceTask(tasks, updated);
    expect(result[1]).toBe(updated);
  });

  it("replaceTask returns the same array when the id is absent", () => {
    const tasks = [makeTask({ id: "a" })];
    expect(replaceTask(tasks, makeTask({ id: "zzz" }))).toBe(tasks);
  });
});

describe("field updates and no-op identity", () => {
  it("updateTaskTitle bumps updatedAtUtc on change", () => {
    const task = makeTask({ title: "old", updatedAtUtc: "2020-01-01T00:00:00.000Z" });
    const result = updateTaskTitle(task, "new");
    expect(result.title).toBe("new");
    expect(result.updatedAtUtc).toBe(FIXED_NOW);
  });

  it("updateTaskTitle returns the same object when unchanged", () => {
    const task = makeTask({ title: "same" });
    expect(updateTaskTitle(task, "same")).toBe(task);
  });

  it("updateTaskDescription returns the same object when unchanged", () => {
    const task = makeTask({ description: "d" });
    expect(updateTaskDescription(task, "d")).toBe(task);
  });

  it("changeTaskPriority returns the same object when unchanged", () => {
    const task = makeTask({ priority: "Urgent" });
    expect(changeTaskPriority(task, "Urgent")).toBe(task);
  });

  it("changeTaskDueDate returns the same object when unchanged", () => {
    const task = makeTask({ dueDate: null });
    expect(changeTaskDueDate(task, null)).toBe(task);
  });
});

describe("changeTaskStatus", () => {
  it("sets completedAtUtc when completing", () => {
    const task = makeTask({ status: "Pending", completedAtUtc: null });
    const result = changeTaskStatus(task, "Completed");
    expect(result.status).toBe("Completed");
    expect(result.completedAtUtc).toBe(FIXED_NOW);
  });

  it("sets completedAtUtc when dismissing", () => {
    const result = changeTaskStatus(makeTask({ status: "Pending" }), "Dismissed");
    expect(result.completedAtUtc).toBe(FIXED_NOW);
  });

  it("clears completedAtUtc when returning to Pending", () => {
    const task = makeTask({ status: "Completed", completedAtUtc: FIXED_NOW });
    const result = changeTaskStatus(task, "Pending");
    expect(result.completedAtUtc).toBeNull();
  });

  it.each([
    ["Completed", "Dismissed"],
    ["Dismissed", "Completed"],
  ] as const)("keeps the handled time moving from %s to %s", (from, to) => {
    const task = makeTask({ status: from, completedAtUtc: HANDLED });
    const result = changeTaskStatus(task, to);
    expect(result.status).toBe(to);
    expect(result.completedAtUtc).toBe(HANDLED);
  });

  it.each([
    ["Pending", "Completed"],
    ["Pending", "Dismissed"],
    ["Completed", "Pending"],
    ["Dismissed", "Pending"],
    ["Completed", "Dismissed"],
  ] as const)("leaves updatedAtUtc alone from %s to %s", (from, to) => {
    const task = makeTask({
      status: from,
      completedAtUtc: from === "Pending" ? null : HANDLED,
      updatedAtUtc: EARLIER,
    });
    expect(changeTaskStatus(task, to).updatedAtUtc).toBe(EARLIER);
  });

  it("returns the same object when status is unchanged", () => {
    const task = makeTask({ status: "Pending" });
    expect(changeTaskStatus(task, "Pending")).toBe(task);
  });
});

describe("notes", () => {
  it("addNote prepends (newest first) and bumps updatedAtUtc", () => {
    const task = makeTask({ notes: [makeNote({ id: "old" })] });
    const result = addNote(task, makeNote({ id: "new" }));
    expect(result.notes.map((n) => n.id)).toEqual(["new", "old"]);
    expect(result.updatedAtUtc).toBe(FIXED_NOW);
  });

  it("updateNoteContent changes the targeted note only", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1", content: "a" }), makeNote({ id: "n2", content: "b" })] });
    const result = updateNoteContent(task, "n1", "z");
    expect(result.notes.find((n) => n.id === "n1")!.content).toBe("z");
    expect(result.notes.find((n) => n.id === "n2")!.content).toBe("b");
  });

  it("updateNoteContent stamps the note's edit time and the task's updatedAtUtc together", () => {
    const task = makeTask({
      updatedAtUtc: EARLIER,
      notes: [makeNote({ id: "n1", content: "a" }), makeNote({ id: "n2", content: "b" })],
    });
    const result = updateNoteContent(task, "n1", "z");
    expect(result.notes[0].editedAtUtc).toBe(FIXED_NOW);
    expect(result.notes[0].createdAtUtc).toBe(task.notes[0].createdAtUtc);
    expect(result.notes[1]).toBe(task.notes[1]);
    expect(result.updatedAtUtc).toBe(FIXED_NOW);
  });

  it("updateNoteContent moves an earlier edit time to the new edit", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1", content: "a", editedAtUtc: EARLIER })] });
    expect(updateNoteContent(task, "n1", "z").notes[0].editedAtUtc).toBe(FIXED_NOW);
  });

  it("updateNoteContent is a no-op for unchanged content", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1", content: "a" })] });
    expect(updateNoteContent(task, "n1", "a")).toBe(task);
  });

  it("updateNoteContent is a no-op for a missing note id", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1" })] });
    expect(updateNoteContent(task, "missing", "z")).toBe(task);
  });

  it("changeNoteActionability updates the note", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1", actionability: "Informational" })] });
    const result = changeNoteActionability(task, "n1", "Actionable");
    expect(result.notes[0].actionability).toBe("Actionable");
  });

  it("changeNoteActionability moves neither the task's updatedAtUtc nor the note's edit time", () => {
    const task = makeTask({
      updatedAtUtc: EARLIER,
      notes: [makeNote({ id: "n1", actionability: "Actionable" })],
    });
    const result = changeNoteActionability(task, "n1", "Resolved");
    expect(result.updatedAtUtc).toBe(EARLIER);
    expect(result.notes[0].editedAtUtc).toBeUndefined();
  });

  it("changeNoteActionability is a no-op when already in that state", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1", actionability: "Resolved" })] });
    expect(changeNoteActionability(task, "n1", "Resolved")).toBe(task);
  });

  it("deleteNote removes the note and bumps updatedAtUtc", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1" }), makeNote({ id: "n2" })] });
    const result = deleteNote(task, "n1");
    expect(result.notes.map((n) => n.id)).toEqual(["n2"]);
  });

  it("deleteNote is a no-op for a missing note id", () => {
    const task = makeTask({ notes: [makeNote({ id: "n1" })] });
    expect(deleteNote(task, "missing")).toBe(task);
  });
});
