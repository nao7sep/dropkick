// Note drafts are the user's uncommitted text, so both directions cost
// something real: a key that stops matching its subject orphans a draft the
// user can never reach again, and a reconciliation that runs too eagerly
// deletes text that was never lost. Both rules are pinned here.

import { describe, it, expect } from "vitest";
import {
  composerDraftKey,
  editorDraftKey,
  collectDraftSubjects,
  reconcileDrafts,
  draftReconcileSubjects,
} from "../../src/services/note-drafts";
import { makeTask, makeNote } from "../helpers/task";
import type { TaskListDto } from "../../src/models";

let listSeq = 0;
function makeList(tasks: TaskListDto["tasks"]): TaskListDto {
  listSeq += 1;
  return { version: "1.0.0", id: `l${listSeq}`, tasks };
}

describe("draft keys", () => {
  it("keeps composer and editor keys for the same task distinct", () => {
    expect(composerDraftKey("t1")).not.toBe(editorDraftKey("t1", "n1"));
  });

  it("keeps editor keys distinct across notes and tasks", () => {
    expect(editorDraftKey("t1", "n1")).not.toBe(editorDraftKey("t1", "n2"));
    expect(editorDraftKey("t1", "n1")).not.toBe(editorDraftKey("t2", "n1"));
  });

  it("omits the file path, so a draft follows a task moved to another list", () => {
    // The same task id in a different file yields the same key, which is what
    // lets a parked draft reappear against the moved task.
    expect(composerDraftKey("t1")).toBe(composerDraftKey("t1"));
    expect(editorDraftKey("t1", "n1")).not.toContain("/");
  });
});

describe("collectDraftSubjects", () => {
  it("claims one subject per task and one per note, across every list", () => {
    const a = makeList([makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })]);
    const b = makeList([makeTask({ id: "t2", notes: [] })]);

    expect(collectDraftSubjects([a, b])).toEqual(
      new Set(["t1", "t1:n1", "t2"]),
    );
  });
});

describe("reconcileDrafts", () => {
  it("drops a draft whose task is gone", () => {
    const drafts = { t1: "kept", tGone: "orphan" };
    expect(reconcileDrafts(drafts, new Set(["t1"]))).toEqual({ t1: "kept" });
  });

  it("drops an edit draft whose note is gone but keeps the task's composer", () => {
    const drafts = { t1: "composer", "t1:n1": "edit of a deleted note" };
    expect(reconcileDrafts(drafts, new Set(["t1"]))).toEqual({ t1: "composer" });
  });

  it("returns the same object when nothing is orphaned, so no write is owed", () => {
    const drafts = { t1: "a", "t1:n1": "b" };
    expect(reconcileDrafts(drafts, new Set(["t1", "t1:n1"]))).toBe(drafts);
  });
});

describe("draftReconcileSubjects", () => {
  const loaded = {
    "/a.json": { data: makeList([makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })]) },
    "/b.json": { data: makeList([makeTask({ id: "t2" })]) },
  };

  it("unions every open list once they have all loaded", () => {
    expect(draftReconcileSubjects(["/a.json", "/b.json"], loaded)).toEqual(
      new Set(["t1", "t1:n1", "t2"]),
    );
  });

  it("refuses while an open list is still missing — its tasks would look orphaned", () => {
    expect(draftReconcileSubjects(["/a.json", "/b.json"], { "/a.json": loaded["/a.json"] })).toBeNull();
  });

  it("refuses when no list is open at all, rather than treating every draft as an orphan", () => {
    expect(draftReconcileSubjects([], loaded)).toBeNull();
  });
});
