// Note drafts are the user's uncommitted text, so both directions cost
// something real: a key that stops matching its subject orphans a draft the
// user can never reach again, and a reconciliation that runs too eagerly
// deletes text that was never lost. Both rules are pinned here.

import { describe, it, expect } from "vitest";
import {
  composerDraftKey,
  editorDraftKey,
  reconcileDrafts,
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

describe("reconcileDrafts", () => {
  const withNote = makeList([
    makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] }),
  ]);

  it("drops an edit draft whose note is gone from a task it can see", () => {
    // The task is right there and the note is not, so the draft is provably
    // orphaned — the only case that is knowable from a partial picture.
    const taskNoNotes = makeList([makeTask({ id: "t1", notes: [] })]);
    const drafts = { t1: "composer", "t1:n1": "edit of a deleted note" };
    expect(reconcileDrafts(drafts, [taskNoNotes])).toEqual({ t1: "composer" });
  });

  it("keeps a draft whose task is in no loaded list", () => {
    // This is the case the previous rule got wrong. A draft key omits its path
    // so it can follow its task between lists, so a task in a list the user
    // merely closed - or one belonging to another workspace, since drafts are
    // machine-global - is indistinguishable from a deleted one. Keeping it is
    // the only safe answer: the alternative silently destroyed typed text.
    const drafts = { tElsewhere: "typed but unsaved", "tElsewhere:n9": "edit" };
    expect(reconcileDrafts(drafts, [withNote])).toBe(drafts);
  });

  it("keeps every draft when nothing at all is loaded", () => {
    const drafts = { t1: "a", "t1:n1": "b" };
    expect(reconcileDrafts(drafts, [])).toBe(drafts);
  });

  it("returns the same object when nothing is orphaned, so no write is owed", () => {
    const drafts = { t1: "a", "t1:n1": "b" };
    expect(reconcileDrafts(drafts, [withNote])).toBe(drafts);
  });

  it("judges each list it can see, across several", () => {
    const other = makeList([makeTask({ id: "t2", notes: [] })]);
    const drafts = { "t1:n1": "live", "t2:gone": "orphan", t2: "composer" };
    expect(reconcileDrafts(drafts, [withNote, other])).toEqual({
      "t1:n1": "live",
      t2: "composer",
    });
  });
});
