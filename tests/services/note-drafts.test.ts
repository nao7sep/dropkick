// Note drafts are the user's uncommitted text, so both directions cost
// something real: a key that stops matching its subject orphans a draft the
// user can never reach again, and a reconciliation that runs too eagerly
// deletes text that was never lost. Both rules are pinned here.

import { describe, it, expect } from "vitest";
import {
  composerDraftKey,
  editorDraftKey,
  fieldDraftKey,
  draftTaskId,
  holdsDraftFor,
  reconcileDrafts,
} from "../../src/services/note-drafts";
import { makeTask, makeNote } from "../helpers/task";
import type { TaskListDto } from "../../src/models";

const copyDraft = (key: string) => `${key}|%2Flist.json`;
let listSeq = 0;
function makeList(tasks: TaskListDto["tasks"]): TaskListDto & { sourceFile: string } {
  listSeq += 1;
  return { id: `l${listSeq}`, tasks, sourceFile: "/list.json" };
}

describe("draft keys", () => {
  it("keeps composer and editor keys for the same task distinct", () => {
    expect(composerDraftKey("t1", "/list.json")).not.toBe(editorDraftKey("t1", "n1", "/list.json"));
  });

  it("keeps editor keys distinct across notes and tasks", () => {
    expect(editorDraftKey("t1", "n1", "/list.json")).not.toBe(editorDraftKey("t1", "n2", "/list.json"));
    expect(editorDraftKey("t1", "n1", "/list.json")).not.toBe(editorDraftKey("t2", "n1", "/list.json"));
  });

  it("separates copies of the same task", () => {
    expect(composerDraftKey("t1", "/list.json")).not.toBe(composerDraftKey("t1", "/other.json"));
    expect(editorDraftKey("t1", "n1", "/list.json")).not.toContain("/");
  });
});

describe("field draft keys", () => {
  it("keeps title and description keys distinct from each other and from note keys", () => {
    const keys = [
      fieldDraftKey("t1", "title", "/list.json"),
      fieldDraftKey("t1", "description", "/list.json"),
      composerDraftKey("t1", "/list.json"),
      editorDraftKey("t1", "title", "/list.json"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names the owning task for every kind of key", () => {
    expect(draftTaskId(composerDraftKey("t1", "/list.json"))).toBe("t1");
    expect(draftTaskId(editorDraftKey("t1", "n1", "/list.json"))).toBe("t1");
    expect(draftTaskId(fieldDraftKey("t1", "title", "/list.json"))).toBe("t1");
    expect(draftTaskId(fieldDraftKey("t1", "description", "/list.json"))).toBe("t1");
  });

  it("keeps a field draft through reconciliation while its task is visible", () => {
    const drafts = { [fieldDraftKey("t1", "title", "/list.json")]: "typed" };
    expect(reconcileDrafts(drafts, [makeList([makeTask({ id: "t1" })])])).toBe(drafts);
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
    const drafts = { [copyDraft("t1")]: "composer", [copyDraft("t1:n1")]: "edit of a deleted note" };
    expect(reconcileDrafts(drafts, [taskNoNotes])).toEqual({ [copyDraft("t1")]: "composer" });
  });

  it("keeps a draft whose task is in no loaded list", () => {
    // This is the case the previous rule got wrong. A draft key omits its path
    // so it can follow its task between lists, so a task in a list the user
    // merely closed - or one belonging to another workspace, since drafts are
    // machine-global - is indistinguishable from a deleted one. Keeping it is
    // the only safe answer: the alternative silently destroyed typed text.
    const drafts = { [copyDraft("tElsewhere")]: "typed but unsaved", [copyDraft("tElsewhere:n9")]: "edit" };
    expect(reconcileDrafts(drafts, [withNote])).toBe(drafts);
  });

  it("keeps every draft when nothing at all is loaded", () => {
    const drafts = { [copyDraft("t1")]: "a", [copyDraft("t1:n1")]: "b" };
    expect(reconcileDrafts(drafts, [])).toBe(drafts);
  });

  it("returns the same object when nothing is orphaned, so no write is owed", () => {
    const drafts = { [copyDraft("t1")]: "a", [copyDraft("t1:n1")]: "b" };
    expect(reconcileDrafts(drafts, [withNote])).toBe(drafts);
  });

  it("judges each list it can see, across several", () => {
    const other = makeList([makeTask({ id: "t2", notes: [] })]);
    const drafts = { [copyDraft("t1:n1")]: "live", [copyDraft("t2:gone")]: "orphan", [copyDraft("t2")]: "composer" };
    expect(reconcileDrafts(drafts, [withNote, other])).toEqual({
      [copyDraft("t1:n1")]: "live",
      [copyDraft("t2")]: "composer",
    });
  });
});

describe("holdsDraftFor", () => {
  const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" })];

  it("finds every kind of draft that belongs to one of the tasks", () => {
    expect(holdsDraftFor({ [composerDraftKey("a", "/list.json")]: "typed" }, tasks)).toBe(true);
    expect(holdsDraftFor({ [editorDraftKey("b", "n1", "/list.json")]: "edited" }, tasks)).toBe(true);
    expect(holdsDraftFor({ [fieldDraftKey("a", "title", "/list.json")]: "renamed" }, tasks)).toBe(true);
  });

  it("ignores drafts for tasks elsewhere, and holds nothing without drafts", () => {
    expect(holdsDraftFor({ [composerDraftKey("z", "/list.json")]: "typed" }, tasks)).toBe(false);
    expect(holdsDraftFor({}, tasks)).toBe(false);
  });
});
