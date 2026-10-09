// The draft store keeps typed text alive while the component showing it comes
// and goes. Drafts last only while Dropkick runs (developer decision): nothing
// here touches the disk, and quit asks before discarding note text
// (hooks/use-window-close).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// Every file operation goes through the Rust core over `invoke`; mocking it
// shows that the store never performs one.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { useNoteDraftStore } from "../../src/state/note-draft-store";
import { makeTask, makeNote } from "../helpers/task";

const invokeMock = invoke as unknown as Mock;

beforeEach(() => {
  useNoteDraftStore.setState({ drafts: {}, editedAtUtc: {}, draftVersions: {}, justOpenedKey: null });
  vi.useFakeTimers();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session-only drafts", () => {
  it("never write a file, however long the typing goes on", async () => {
    const { setDraft, clearDraft } = useNoteDraftStore.getState();
    setDraft("t1", "half a thought");
    setDraft("t1:n1", "an edited note");
    setDraft("t1#title", "retitled");
    await vi.advanceTimersByTimeAsync(10_000);
    clearDraft("t1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useNoteDraftStore.getState().drafts).toEqual({ "t1:n1": "an edited note", "t1#title": "retitled" });
  });

  it("keep the canonical edit instant while only whitespace changes", () => {
    vi.setSystemTime(new Date("2026-10-07T01:00:00.000Z"));
    useNoteDraftStore.getState().setDraft("t1#title", "New title");
    vi.setSystemTime(new Date("2026-10-07T01:01:00.000Z"));
    useNoteDraftStore.getState().setDraft("t1#title", "  New   title  ");
    expect(useNoteDraftStore.getState().editedAtUtc["t1#title"]).toBe("2026-10-07T01:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-07T02:00:00.000Z"));
    useNoteDraftStore.getState().setDraft("t1#title", "Changed title");
    expect(useNoteDraftStore.getState().editedAtUtc["t1#title"]).toBe("2026-10-07T02:00:00.000Z");
  });
});

describe("reconcile", () => {
  it("drops only drafts whose note is provably gone", () => {
    useNoteDraftStore.getState().setDraft("t1:n1", "edit of a live note");
    useNoteDraftStore.getState().setDraft("t1:gone", "edit of a deleted note");

    // The task is loaded and note n1 is on it, so only the draft naming a note
    // that is provably absent is dropped.
    useNoteDraftStore.getState().reconcile([
      {
        id: "L1",
        tasks: [makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })],
      },
    ]);

    expect(useNoteDraftStore.getState().drafts).toEqual({
      "t1:n1": "edit of a live note",
    });
  });
});

describe("clearTaskDrafts", () => {
  it("removes the deleted task's composer, edit, title and description drafts and nothing else", () => {
    const { setDraft } = useNoteDraftStore.getState();
    setDraft("t1", "composer");
    setDraft("t1:n1", "one");
    setDraft("t1#title", "retitled");
    setDraft("t1#description", "described");
    setDraft("t2", "other task");

    useNoteDraftStore.getState().clearTaskDrafts("t1");

    expect(useNoteDraftStore.getState().drafts).toEqual({ t2: "other task" });
  });
});

describe("clearDraftIf", () => {
  it("clears the draft when it still reads as it did when the write started", () => {
    const { setDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft("t1:n1", "committed text");
    const version = useNoteDraftStore.getState().draftVersions["t1:n1"];

    clearDraftIf("t1:n1", "committed text", version);

    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBeUndefined();
  });

  it("keeps a keystroke typed while the write was in flight", () => {
    const { setDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft("t1:n1", "committed text");
    const version = useNoteDraftStore.getState().draftVersions["t1:n1"];
    // The user kept typing during the await; this text was never written.
    setDraft("t1:n1", "committed text and more");

    clearDraftIf("t1:n1", "committed text", version);

    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBe(
      "committed text and more",
    );
  });
});

describe("draft receipt generations", () => {
  it.each(["t1#title", "t1#description", "t1", "t1:n1"])("keeps an A/B/A draft for %s", (key) => {
    const { setDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft(key, "A");
    const version = useNoteDraftStore.getState().draftVersions[key];
    setDraft(key, "B");
    setDraft(key, "A");
    expect(clearDraftIf(key, "A", version)).toBe(false);
    expect(useNoteDraftStore.getState().drafts[key]).toBe("A");
  });

  it("keeps a recreated draft but permits unrelated typing", () => {
    const { setDraft, clearDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft("t1", "A");
    const old = useNoteDraftStore.getState().draftVersions.t1;
    clearDraft("t1");
    setDraft("t1", "A");
    expect(clearDraftIf("t1", "A", old)).toBe(false);
    const current = useNoteDraftStore.getState().draftVersions.t1;
    setDraft("t2", "B");
    expect(clearDraftIf("t1", "A", current)).toBe(true);
  });
});

describe("openDraft", () => {
  it("marks the editor the user just opened, so focus follows opening", () => {
    useNoteDraftStore.getState().openDraft("t1:n1", "the note");

    expect(useNoteDraftStore.getState().justOpenedKey).toBe("t1:n1");
    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBe("the note");
  });

  it("does not mark a draft that was merely typed into", () => {
    useNoteDraftStore.getState().setDraft("t1", "typing in the composer");

    expect(useNoteDraftStore.getState().justOpenedKey).toBeNull();
  });

  it("clears the mark once consumed, so a remount cannot re-steal focus", () => {
    useNoteDraftStore.getState().openDraft("t1:n1", "the note");
    useNoteDraftStore.getState().clearJustOpened();

    expect(useNoteDraftStore.getState().justOpenedKey).toBeNull();
  });
});
