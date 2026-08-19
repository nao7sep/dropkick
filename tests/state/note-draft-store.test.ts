// The note-draft store is a safety surface: text a user typed but has not
// saved lives here so it survives the detail pane unmounting, and the quit
// guard's "may I close silently?" question is answered by hasUnsavedDrafts.
// A wrong answer either loses typed text (false negative) or nags on quit
// with nothing at risk (false positive), so the dirtiness rules are pinned.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useNoteDraftStore,
  composerDraftKey,
  editorDraftKey,
  isDraftDirty,
  hasUnsavedDrafts,
} from "../../src/state/note-draft-store";

function reset() {
  useNoteDraftStore.setState({ drafts: {} });
}

describe("draft keys", () => {
  it("keeps composer and editor keys for the same task distinct", () => {
    expect(composerDraftKey("t1")).not.toBe(editorDraftKey("t1", "n1"));
  });

  it("keeps editor keys distinct across notes and tasks", () => {
    expect(editorDraftKey("t1", "n1")).not.toBe(editorDraftKey("t1", "n2"));
    expect(editorDraftKey("t1", "n1")).not.toBe(editorDraftKey("t2", "n1"));
  });
});

describe("dirtiness", () => {
  it("an untouched edit draft is not unsaved work", () => {
    expect(isDraftDirty({ text: "note body", baseline: "note body" })).toBe(false);
  });

  it("a whitespace-only composer draft is not unsaved work", () => {
    expect(isDraftDirty({ text: "  \n\n  ", baseline: "" })).toBe(false);
  });

  it("typed composer text is unsaved work", () => {
    expect(isDraftDirty({ text: "half a thought", baseline: "" })).toBe(true);
  });

  it("an edit that changes cleaned content is unsaved work", () => {
    expect(isDraftDirty({ text: "note body changed", baseline: "note body" })).toBe(true);
  });

  it("an edit differing only by trailing whitespace is not unsaved work", () => {
    expect(isDraftDirty({ text: "note body  \n", baseline: "note body" })).toBe(false);
  });
});

describe("store actions", () => {
  beforeEach(reset);

  it("updateDraft creates a composer draft with an empty baseline", () => {
    useNoteDraftStore.getState().updateDraft(composerDraftKey("t1"), "hi");
    const { drafts } = useNoteDraftStore.getState();
    expect(drafts[composerDraftKey("t1")]).toEqual({ text: "hi", baseline: "" });
    expect(hasUnsavedDrafts(drafts)).toBe(true);
  });

  it("beginDraft seeds text and baseline together, so opening an editor is clean", () => {
    useNoteDraftStore.getState().beginDraft(editorDraftKey("t1", "n1"), "body");
    const { drafts } = useNoteDraftStore.getState();
    expect(hasUnsavedDrafts(drafts)).toBe(false);
  });

  it("updateDraft after beginDraft keeps the seeded baseline", () => {
    const key = editorDraftKey("t1", "n1");
    useNoteDraftStore.getState().beginDraft(key, "body");
    useNoteDraftStore.getState().updateDraft(key, "body edited");
    const { drafts } = useNoteDraftStore.getState();
    expect(drafts[key]).toEqual({ text: "body edited", baseline: "body" });
    expect(hasUnsavedDrafts(drafts)).toBe(true);
  });

  it("clearDraft removes exactly the one entry", () => {
    useNoteDraftStore.getState().updateDraft(composerDraftKey("t1"), "a");
    useNoteDraftStore.getState().updateDraft(composerDraftKey("t2"), "b");
    useNoteDraftStore.getState().clearDraft(composerDraftKey("t1"));
    const { drafts } = useNoteDraftStore.getState();
    expect(drafts[composerDraftKey("t1")]).toBeUndefined();
    expect(drafts[composerDraftKey("t2")]).toBeDefined();
  });

  it("clearTaskDrafts removes the task's composer and editor drafts and nothing else", () => {
    const s = useNoteDraftStore.getState();
    s.updateDraft(composerDraftKey("t1"), "composer");
    s.beginDraft(editorDraftKey("t1", "n1"), "one");
    s.beginDraft(editorDraftKey("t1", "n2"), "two");
    s.updateDraft(composerDraftKey("t2"), "other task");
    useNoteDraftStore.getState().clearTaskDrafts("t1");
    const { drafts } = useNoteDraftStore.getState();
    expect(Object.keys(drafts)).toEqual([composerDraftKey("t2")]);
  });

  it("hasUnsavedDrafts is false once every draft is cleared", () => {
    const key = composerDraftKey("t1");
    useNoteDraftStore.getState().updateDraft(key, "typed");
    useNoteDraftStore.getState().clearDraft(key);
    expect(hasUnsavedDrafts(useNoteDraftStore.getState().drafts)).toBe(false);
  });
});
