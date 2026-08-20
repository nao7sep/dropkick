// The draft store is the whole defence for text the user has typed and not yet
// saved. On macOS the window's close-request handler never sees Cmd+Q, the app
// menu, or Dock > Quit, and no handler anywhere sees a force-quit or a crash —
// so what protects the text is that it is ALREADY on disk, written through as
// it is typed. These specs drive the store with no close event of any kind,
// which is exactly the shape of those exits.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

// Every file operation the store performs goes through the Rust core over
// `invoke`; mocking it gives us the exact bytes that would reach disk.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  useNoteDraftStore,
  flushNoteDraftsNow,
} from "../../src/state/note-draft-store";
import { makeTask, makeNote } from "../helpers/task";

const invokeMock = invoke as unknown as Mock;
const ROOT = "/home/u/.dropkick";
const DRAFTS_PATH = `${ROOT}/note-drafts.json`;

// What `read_text_file` answers for the drafts file, set per test.
let diskRead: unknown;

function draftWrites(): Record<string, string>[] {
  return invokeMock.mock.calls
    .filter(
      (c) =>
        c[0] === "write_text_file_atomic" &&
        (c[1] as { path: string }).path === DRAFTS_PATH,
    )
    .map(
      (c) =>
        JSON.parse((c[1] as { contents: string }).contents).drafts as Record<
          string,
          string
        >,
    );
}

beforeEach(async () => {
  // Clear any coalescing window a previous spec left open before the fake clock
  // is swapped underneath it.
  useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: false });
  await flushNoteDraftsNow();

  vi.useFakeTimers();
  invokeMock.mockReset();
  diskRead = { status: "missing" };
  invokeMock.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "app_paths":
        return Promise.resolve({
          root: ROOT,
          stateFile: `${ROOT}/state.json`,
          preferencesFile: `${ROOT}/preferences.json`,
          workspaceFile: `${ROOT}/workspace.json`,
          noteDraftsFile: DRAFTS_PATH,
          logsDir: `${ROOT}/logs`,
          backupsFile: `${ROOT}/backups.sqlite3`,
        });
      case "read_text_file":
        return Promise.resolve(diskRead);
      case "quarantine_file":
        return Promise.resolve(`${ROOT}/note-drafts-20260820-000000-000-utc.invalid`);
      default:
        return Promise.resolve();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// Puts the store in the state it is in for a normal session: file read, empty,
// persistence enabled.
async function loadEmpty(): Promise<void> {
  await useNoteDraftStore.getState().load();
}

describe("write-through", () => {
  it("puts typed text on disk with no close event of any kind", async () => {
    await loadEmpty();

    useNoteDraftStore.getState().setDraft("t1", "half a thought");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites().at(-1)).toEqual({ t1: "half a thought" });
  });

  it("coalesces a burst of keystrokes into a single write of the latest text", async () => {
    await loadEmpty();

    const { setDraft } = useNoteDraftStore.getState();
    setDraft("t1", "h");
    await vi.advanceTimersByTimeAsync(100);
    setDraft("t1", "ha");
    await vi.advanceTimersByTimeAsync(100);
    setDraft("t1", "half");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites()).toEqual([{ t1: "half" }]);
  });

  it("still writes during sustained typing that never pauses long enough to settle", async () => {
    await loadEmpty();

    // A keystroke every 400 ms keeps resetting the idle debounce, so only the
    // max-wait bound can end the coalescing window.
    for (let elapsed = 0; elapsed < 3000; elapsed += 400) {
      useNoteDraftStore.getState().setDraft("t1", `typed ${elapsed}`);
      await vi.advanceTimersByTimeAsync(400);
    }

    expect(draftWrites().length).toBeGreaterThan(0);
  });

  it("writes the editor draft too, so a parked edit is on disk as well", async () => {
    await loadEmpty();

    useNoteDraftStore.getState().setDraft("t1:n1", "an edited note");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites().at(-1)).toEqual({ "t1:n1": "an edited note" });
  });

  it("writes the removal when a draft is cleared", async () => {
    await loadEmpty();
    useNoteDraftStore.getState().setDraft("t1", "typed");
    await vi.advanceTimersByTimeAsync(500);

    useNoteDraftStore.getState().clearDraft("t1");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites().at(-1)).toEqual({});
  });

  it("costs no write when nothing changed", async () => {
    await loadEmpty();
    useNoteDraftStore.getState().setDraft("t1", "typed");
    await vi.advanceTimersByTimeAsync(500);
    const before = draftWrites().length;

    useNoteDraftStore.getState().setDraft("t1", "typed");
    useNoteDraftStore.getState().clearDraft("nothing-here");
    useNoteDraftStore.getState().clearTaskDrafts("some-other-task");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites().length).toBe(before);
  });

  it("flushes on demand without waiting out the coalescing window", async () => {
    await loadEmpty();

    useNoteDraftStore.getState().setDraft("t1", "last keystrokes");
    await flushNoteDraftsNow();

    expect(draftWrites().at(-1)).toEqual({ t1: "last keystrokes" });
  });
});

describe("load", () => {
  it("brings back the drafts a previous session left on disk", async () => {
    diskRead = {
      status: "success",
      text: JSON.stringify({
        version: "1.0.0",
        drafts: { t1: "survived the quit", "t1:n1": "a parked edit" },
      }),
    };

    await useNoteDraftStore.getState().load();

    expect(useNoteDraftStore.getState().drafts).toEqual({
      t1: "survived the quit",
      "t1:n1": "a parked edit",
    });
  });

  it("starts empty and enabled when the file has never been written", async () => {
    await loadEmpty();

    expect(useNoteDraftStore.getState().drafts).toEqual({});
    expect(useNoteDraftStore.getState().filePath).toBe(DRAFTS_PATH);
  });

  it("quarantines an unparseable file and reports the path instead of losing it silently", async () => {
    diskRead = { status: "success", text: "{ not json" };

    const quarantinedTo = await useNoteDraftStore.getState().load();

    expect(quarantinedTo).toContain(".invalid");
    expect(invokeMock.mock.calls.some((c) => c[0] === "quarantine_file")).toBe(true);
  });

  it("quarantines a file whose drafts are not text, rather than feeding it to an editor", async () => {
    diskRead = {
      status: "success",
      text: JSON.stringify({ version: "1.0.0", drafts: { t1: { text: "wrong shape" } } }),
    };

    const quarantinedTo = await useNoteDraftStore.getState().load();

    expect(quarantinedTo).toContain(".invalid");
    expect(useNoteDraftStore.getState().drafts).toEqual({});
  });

  it("never writes over bytes it failed to read", async () => {
    diskRead = { status: "error", message: "permission denied" };

    await useNoteDraftStore.getState().load();
    useNoteDraftStore.getState().setDraft("t1", "typed this session");
    await vi.advanceTimersByTimeAsync(3000);

    expect(useNoteDraftStore.getState().filePath).toBe("");
    expect(draftWrites()).toEqual([]);
    // The text is still usable in memory — only the disk copy is given up.
    expect(useNoteDraftStore.getState().drafts).toEqual({ t1: "typed this session" });
  });
});

describe("reconcile", () => {
  it("drops orphans and persists the smaller set", async () => {
    diskRead = {
      status: "success",
      text: JSON.stringify({
        version: "1.0.0",
        drafts: {
          "t1:n1": "edit of a live note",
          "t1:gone": "edit of a deleted note",
        },
      }),
    };
    await useNoteDraftStore.getState().load();

    // The task is loaded and note n1 is on it, so only the draft naming a note
    // that is provably absent is dropped.
    useNoteDraftStore.getState().reconcile([
      {
        version: "1.0.0",
        id: "L1",
        tasks: [makeTask({ id: "t1", notes: [makeNote({ id: "n1" })] })],
      },
    ]);
    await vi.advanceTimersByTimeAsync(500);

    expect(useNoteDraftStore.getState().drafts).toEqual({
      "t1:n1": "edit of a live note",
    });
    expect(draftWrites().at(-1)).toEqual({ "t1:n1": "edit of a live note" });
  });
});

describe("clearTaskDrafts", () => {
  it("removes the deleted task's composer and edit drafts and nothing else", async () => {
    await loadEmpty();
    const { setDraft } = useNoteDraftStore.getState();
    setDraft("t1", "composer");
    setDraft("t1:n1", "one");
    setDraft("t2", "other task");

    useNoteDraftStore.getState().clearTaskDrafts("t1");
    await vi.advanceTimersByTimeAsync(500);

    expect(draftWrites().at(-1)).toEqual({ t2: "other task" });
  });
});

describe("clearDraftIf", () => {
  it("clears the draft when it still reads as it did when the write started", async () => {
    await loadEmpty();
    const { setDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft("t1:n1", "committed text");

    clearDraftIf("t1:n1", "committed text");

    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBeUndefined();
  });

  it("keeps a keystroke typed while the write was in flight", async () => {
    await loadEmpty();
    const { setDraft, clearDraftIf } = useNoteDraftStore.getState();
    setDraft("t1:n1", "committed text");
    // The user kept typing during the await; this text was never written.
    setDraft("t1:n1", "committed text and more");

    clearDraftIf("t1:n1", "committed text");

    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBe(
      "committed text and more",
    );
  });
});

describe("openDraft", () => {
  it("marks the editor the user just opened, so focus follows opening", async () => {
    await loadEmpty();
    useNoteDraftStore.getState().openDraft("t1:n1", "the note");

    expect(useNoteDraftStore.getState().justOpenedKey).toBe("t1:n1");
    expect(useNoteDraftStore.getState().drafts["t1:n1"]).toBe("the note");
  });

  it("does not mark a draft that was merely typed into", async () => {
    await loadEmpty();
    useNoteDraftStore.getState().setDraft("t1", "typing in the composer");

    expect(useNoteDraftStore.getState().justOpenedKey).toBeNull();
  });

  it("clears the mark once consumed, so a remount cannot re-steal focus", async () => {
    await loadEmpty();
    useNoteDraftStore.getState().openDraft("t1:n1", "the note");
    useNoteDraftStore.getState().clearJustOpened();

    expect(useNoteDraftStore.getState().justOpenedKey).toBeNull();
  });
});
