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
import { useDraftStore } from "../../src/state/draft-store";
import { makeTask, makeNote } from "../helpers/task";

const copyDraft = (key: string) => `${key}|%2Flist.json`;
const invokeMock = invoke as unknown as Mock;

beforeEach(() => {
  useDraftStore.setState({ drafts: {}, editedAtUtc: {}, draftVersions: {}, parkedTasks: {}, justOpenedKey: null });
  vi.useFakeTimers();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session-only drafts", () => {
  it("never write a file, however long the typing goes on", async () => {
    const { setDraft, clearDraft } = useDraftStore.getState();
    setDraft(copyDraft("t1"), "half a thought");
    setDraft(copyDraft("t1:n1"), "an edited note");
    setDraft(copyDraft("t1#title"), "retitled");
    await vi.advanceTimersByTimeAsync(10_000);
    clearDraft(copyDraft("t1"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(useDraftStore.getState().drafts).toEqual({ [copyDraft("t1:n1")]: "an edited note", [copyDraft("t1#title")]: "retitled" });
  });

  it("keep the canonical edit instant while only whitespace changes", () => {
    vi.setSystemTime(new Date("2026-10-07T01:00:00.000Z"));
    useDraftStore.getState().setDraft(copyDraft("t1#title"), "New title");
    vi.setSystemTime(new Date("2026-10-07T01:01:00.000Z"));
    useDraftStore.getState().setDraft(copyDraft("t1#title"), "  New   title  ");
    expect(useDraftStore.getState().editedAtUtc[copyDraft("t1#title")]).toBe("2026-10-07T01:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-07T02:00:00.000Z"));
    useDraftStore.getState().setDraft(copyDraft("t1#title"), "Changed title");
    expect(useDraftStore.getState().editedAtUtc[copyDraft("t1#title")]).toBe("2026-10-07T02:00:00.000Z");
  });
});

describe("reconcile", () => {
  it("a reopened copy supersedes only its own closed context", () => {
    const store = useDraftStore.getState();
    store.setDraft("t1:n1|%2Fsource.json", "edited");
    store.rememberTasks({ id: "source", tasks: [makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })] }, "/source.json");
    const other = { id: "other", sourceFile: "/other.json", tasks: [makeTask({ id: "t1", notes: [] })] };
    store.reconcile([other]);
    expect(useDraftStore.getState().drafts["t1:n1|%2Fsource.json"]).toBe("edited");
    store.reconcile([other, { id: "source", sourceFile: "/source.json", tasks: [makeTask({ id: "t1", notes: [] })] }]);
    expect(useDraftStore.getState().drafts).toEqual({});
    expect(useDraftStore.getState().parkedTasks).toEqual({});
  });
  it("drops only drafts whose note is provably gone", () => {
    useDraftStore.getState().setDraft(copyDraft("t1:n1"), "edit of a live note");
    useDraftStore.getState().setDraft(copyDraft("t1:gone"), "edit of a deleted note");

    // The task is loaded and note n1 is on it, so only the draft naming a note
    // that is provably absent is dropped.
    useDraftStore.getState().reconcile([
      {
        id: "L1", sourceFile: "/list.json",
        tasks: [makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })],
      },
    ]);

    expect(useDraftStore.getState().drafts).toEqual({
      [copyDraft("t1:n1")]: "edit of a live note",
    });
  });
});

describe("clearTaskDrafts", () => {
  it("removes the deleted task's composer, edit, title and description drafts and nothing else", () => {
    const { setDraft } = useDraftStore.getState();
    setDraft(copyDraft("t1"), "composer");
    setDraft(copyDraft("t1:n1"), "one");
    setDraft(copyDraft("t1#title"), "retitled");
    setDraft(copyDraft("t1#description"), "described");
    setDraft(copyDraft("t2"), "other task");

    useDraftStore.getState().clearTaskDrafts("t1", "/list.json");

    expect(useDraftStore.getState().drafts).toEqual({ [copyDraft("t2")]: "other task" });
  });
});

describe("clearDraftIf", () => {
  it("clears the draft when it still reads as it did when the write started", () => {
    const { setDraft, clearDraftIf } = useDraftStore.getState();
    setDraft(copyDraft("t1:n1"), "committed text");
    const version = useDraftStore.getState().draftVersions[copyDraft("t1:n1")];

    clearDraftIf(copyDraft("t1:n1"), "committed text", version);

    expect(useDraftStore.getState().drafts[copyDraft("t1:n1")]).toBeUndefined();
  });

  it("keeps a keystroke typed while the write was in flight", () => {
    const { setDraft, clearDraftIf } = useDraftStore.getState();
    setDraft(copyDraft("t1:n1"), "committed text");
    const version = useDraftStore.getState().draftVersions[copyDraft("t1:n1")];
    // The user kept typing during the await; this text was never written.
    setDraft(copyDraft("t1:n1"), "committed text and more");

    clearDraftIf(copyDraft("t1:n1"), "committed text", version);

    expect(useDraftStore.getState().drafts[copyDraft("t1:n1")]).toBe(
      "committed text and more",
    );
  });
});

describe("draft receipt generations", () => {
  it("equal text on different copies has independent receipts", () => {
    const { setDraft, clearDraftIf } = useDraftStore.getState();
    const a = "t1#title|%2Fsource.json", b = "t1#title|%2Fother.json";
    setDraft(a, "Equal text");
    const version = useDraftStore.getState().draftVersions[a];
    setDraft(b, "Equal text");
    expect(clearDraftIf(a, "Equal text", version)).toBe(true);
    expect(useDraftStore.getState().drafts[b]).toBe("Equal text");
  });

  it.each(["t1#title", "t1#description", "t1", "t1:n1"])("keeps an A/B/A draft for %s", (key) => {
    const { setDraft, clearDraftIf } = useDraftStore.getState();
    setDraft(key, "A");
    const version = useDraftStore.getState().draftVersions[key];
    setDraft(key, "B");
    setDraft(key, "A");
    expect(clearDraftIf(key, "A", version)).toBe(false);
    expect(useDraftStore.getState().drafts[key]).toBe("A");
  });

  it("keeps a recreated draft but permits unrelated typing", () => {
    const { setDraft, clearDraft, clearDraftIf } = useDraftStore.getState();
    setDraft(copyDraft("t1"), "A");
    const old = useDraftStore.getState().draftVersions[copyDraft("t1")];
    clearDraft(copyDraft("t1"));
    setDraft(copyDraft("t1"), "A");
    expect(clearDraftIf(copyDraft("t1"), "A", old)).toBe(false);
    const current = useDraftStore.getState().draftVersions[copyDraft("t1")];
    setDraft(copyDraft("t2"), "B");
    expect(clearDraftIf(copyDraft("t1"), "A", current)).toBe(true);
  });
});

describe("openDraft", () => {
  it("marks the editor the user just opened, so focus follows opening", () => {
    useDraftStore.getState().openDraft(copyDraft("t1:n1"), "the note");

    expect(useDraftStore.getState().justOpenedKey).toBe(copyDraft("t1:n1"));
    expect(useDraftStore.getState().drafts[copyDraft("t1:n1")]).toBe("the note");
  });

  it("does not mark a draft that was merely typed into", () => {
    useDraftStore.getState().setDraft(copyDraft("t1"), "typing in the composer");

    expect(useDraftStore.getState().justOpenedKey).toBeNull();
  });

  it("clears the mark once consumed, so a remount cannot re-steal focus", () => {
    useDraftStore.getState().openDraft(copyDraft("t1:n1"), "the note");
    useDraftStore.getState().clearJustOpened();

    expect(useDraftStore.getState().justOpenedKey).toBeNull();
  });
});

describe("composer submission ownership", () => {
  it("joins a submitted generation across editor remount and task move", async () => {
    const key = copyDraft("t1");
    useDraftStore.getState().setDraft(key, "one note");
    let finish!: (value: { status: "success" }) => void;
    const write = vi.fn(() => new Promise<{ status: "success" }>((resolve) => { finish = resolve; }));
    const first = useDraftStore.getState().submitDraft(key, write);
    await Promise.resolve();
    useDraftStore.getState().moveTaskDrafts(new Set(["t1"]), "/list.json", "/destination.json");
    const moved = "t1|%2Fdestination.json";
    const second = useDraftStore.getState().submitDraft(moved, write);
    expect(second).toBe(first);
    expect(write).toHaveBeenCalledOnce();
    finish({ status: "success" });
    await first;
    expect(useDraftStore.getState().drafts[moved]).toBeUndefined();
    expect(useDraftStore.getState().submittingVersions.size).toBe(0);
  });

  it("preserves later typing when an accepted note settles", async () => {
    const key = copyDraft("t1");
    useDraftStore.getState().setDraft(key, "submitted");
    let finish!: (value: { status: "success" }) => void;
    const first = useDraftStore.getState().submitDraft(key, () => new Promise((resolve) => { finish = resolve; }));
    await Promise.resolve();
    useDraftStore.getState().setDraft(key, "next note");
    finish({ status: "success" });
    await first;
    expect(useDraftStore.getState().drafts[key]).toBe("next note");
  });
});
