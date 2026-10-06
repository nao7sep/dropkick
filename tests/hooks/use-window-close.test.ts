// @vitest-environment happy-dom
//
// The quit wiring — the seam the previous suite never reached, which is where
// both defects on this path lived. What matters here:
//
//   1. The graceful close gets the last keystrokes onto disk BEFORE the window
//      is destroyed, so the coalescing window costs nothing.
//   2. It asks nothing about work that is on disk. It asks only about a write
//      that is stuck (the wait is bounded, and past the bound the user may
//      close anyway) or a write of the user's own work — drafts or a task
//      list — that failed (Retry or Quit Anyway).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { createElement, act, StrictMode } from "react";
import { mount } from "../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const windowStub = vi.hoisted(() => ({
  handlers: [] as Array<(event: { preventDefault: () => void }) => unknown>,
  events: [] as string[],
  unlistened: 0,
}));

// Task-list writes go through the real per-file serial chain, so the close's
// drain waits for them exactly as it does for the real ones; only the disk is
// replaced, failing outright while `failListWrites` is set.
const listDisk = vi.hoisted(() => ({ fail: false, written: [] as string[] }));

vi.mock("../../src/repositories/task-list-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/repositories/task-list-repository")>();
  const { withSerial } = await import("../../src/repositories/file-system");
  return {
    ...actual,
    flushTaskList: (path: string, getData: () => { tasks: { priority: string }[] }) =>
      withSerial(path, async () => {
        const data = getData();
        if (listDisk.fail) throw new Error("read-only volume");
        listDisk.written.push(`${path}:${data.tasks.map((task) => task.priority).join(",")}`);
        return { status: "success" };
      }),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => unknown,
    ) => {
      windowStub.handlers.push(handler);
      return () => {
        windowStub.unlistened += 1;
      };
    },
    destroy: async () => {
      windowStub.events.push("destroy");
    },
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { prepareWindowClose, useWindowClose } from "../../src/hooks/use-window-close";
import { withSerial } from "../../src/repositories/file-system";
import { useNoteDraftStore, flushNoteDraftsNow } from "../../src/state/note-draft-store";
import { useDialogStore } from "../../src/state/dialog-store";
import { useTaskListStore } from "../../src/state/task-list-store";
import { makeTask } from "../helpers/task";

const invokeMock = invoke as unknown as Mock;
const DRAFTS_PATH = "/home/u/.dropkick/note-drafts.json";
// Set per test to make every draft write fail, as on a full or read-only disk.
let failDraftWrites = false;

function Harness() {
  useWindowClose();
  return null;
}

async function mountHarness(): Promise<void> {
  await mount(createElement(Harness));
}

async function requestClose(): Promise<void> {
  const handler = windowStub.handlers.at(-1);
  if (!handler) throw new Error("useWindowClose registered no close handler");
  let prevented = false;
  await act(async () => {
    await handler({
      preventDefault: () => {
        prevented = true;
      },
    });
  });
  expect(prevented).toBe(true);
}

beforeEach(async () => {
  windowStub.handlers.length = 0;
  windowStub.events.length = 0;
  windowStub.unlistened = 0;
  listDisk.fail = false;
  listDisk.written.length = 0;
  useTaskListStore.setState({ files: {} });
  useTaskListStore.getState().forgetFailedWrites();

  useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: false });
  await flushNoteDraftsNow();
  useDialogStore.setState({ current: null, queue: [] });

  invokeMock.mockReset();
  failDraftWrites = false;
  invokeMock.mockImplementation((cmd: string, args: unknown) => {
    if (
      cmd === "write_text_file_atomic" &&
      (args as { path: string }).path === DRAFTS_PATH
    ) {
      if (failDraftWrites) return Promise.reject(new Error("disk full"));
      windowStub.events.push(
        `write:${(args as { contents: string }).contents.replace(/\s+/g, "")}`,
      );
    }
    return Promise.resolve();
  });

  // A session with drafts already persisting, and a keystroke still inside the
  // coalescing window.
  useNoteDraftStore.setState({ filePath: DRAFTS_PATH, loaded: true });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("close request", () => {
  it("gets a still-coalescing draft onto disk before destroying the window", async () => {
    await mountHarness();
    useNoteDraftStore.getState().setDraft("t1", "typed a second ago");

    await requestClose();

    expect(windowStub.events).toEqual([
      'write:{"formatVersion":1,"drafts":{"t1":"typedasecondago"}}',
      "destroy",
    ]);
  });

  it("closes without asking, even with unsaved drafts", async () => {
    await mountHarness();
    useNoteDraftStore.getState().setDraft("t1", "half a thought");

    await requestClose();

    expect(useDialogStore.getState().current).toBeNull();
    expect(useDialogStore.getState().queue).toEqual([]);
    expect(windowStub.events).toContain("destroy");
  });

  it("still destroys when there is nothing pending to write", async () => {
    await mountHarness();

    await requestClose();

    expect(windowStub.events).toEqual(["destroy"]);
  });

  it("registers exactly one listener despite the StrictMode double mount", async () => {
    await mount(createElement(StrictMode, null, createElement(Harness)));

    // One live listener: any extra registration is matched by an unlisten.
    expect(windowStub.handlers.length - windowStub.unlistened).toBe(1);
  });
});

// A write the test holds open, standing in for one stuck on an unresponsive
// volume.
function stuckWrite(path: string): () => void {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  void withSerial(path, () => held);
  return release;
}

async function waitForDialog(): Promise<void> {
  for (let i = 0; i < 50 && !useDialogStore.getState().current; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("a write that does not finish", () => {
  const LIST = "/Volumes/share/tasks.json";

  it("names the file after the bound and closes when the user closes anyway", async () => {
    const release = stuckWrite(LIST);
    const closing = prepareWindowClose(10);

    await waitForDialog();
    const dialog = useDialogStore.getState().current;
    expect(dialog?.body.values).toEqual({ paths: LIST });
    useDialogStore.getState().confirmCurrent();

    await expect(closing).resolves.toBe(true);
    release();
  });

  it("stays open when the user keeps it open", async () => {
    const release = stuckWrite(LIST);
    const closing = prepareWindowClose(10);

    await waitForDialog();
    useDialogStore.getState().cancelCurrent();

    await expect(closing).resolves.toBe(false);
    release();
  });

  it("withdraws the question and closes once the write finishes", async () => {
    const release = stuckWrite(LIST);
    const closing = prepareWindowClose(10);

    await waitForDialog();
    expect(useDialogStore.getState().current).not.toBeNull();
    release();

    await expect(closing).resolves.toBe(true);
    expect(useDialogStore.getState().current).toBeNull();
  });

  it("runs one close at a time however often close is requested", async () => {
    await mountHarness();
    const release = stuckWrite(LIST);

    const handler = windowStub.handlers.at(-1)!;
    const first = handler({ preventDefault: () => {} });
    await requestClose(); // a second click while the first still waits
    expect(windowStub.events).toEqual([]);

    release();
    await act(async () => {
      await first;
    });
    expect(windowStub.events).toEqual(["destroy"]);
  });
});

describe("a draft write that fails", () => {
  it("holds the close, names the file and retries on request", async () => {
    await mountHarness();
    failDraftWrites = true;
    useNoteDraftStore.getState().setDraft("t1", "typed on a full disk");
    const closing = prepareWindowClose();

    await waitForDialog();
    const dialog = useDialogStore.getState().current;
    expect(dialog?.title.key).toBe("dialog.notSaved.title");
    expect(dialog?.body.values).toEqual({ paths: DRAFTS_PATH });

    // Retry with the disk still full asks again.
    useDialogStore.getState().cancelCurrent();
    await waitForDialog();
    expect(useDialogStore.getState().current?.title.key).toBe("dialog.notSaved.title");

    // Retry once the disk has room writes the text and lets the close go ahead.
    failDraftWrites = false;
    useDialogStore.getState().cancelCurrent();
    await expect(closing).resolves.toBe(true);
    expect(windowStub.events).toEqual([
      'write:{"formatVersion":1,"drafts":{"t1":"typedonafulldisk"}}',
    ]);
  });

  it("closes when the user quits anyway", async () => {
    await mountHarness();
    failDraftWrites = true;
    useNoteDraftStore.getState().setDraft("t1", "typed on a full disk");
    const closing = prepareWindowClose();

    await waitForDialog();
    useDialogStore.getState().confirmCurrent();

    await expect(closing).resolves.toBe(true);
  });
});

const LIST = "/Users/u/Lists/home.json";

// A loaded list whose last save landed, so a failed write has a confirmed copy
// to roll back to.
async function seedList(): Promise<void> {
  useTaskListStore.setState({
    files: { [LIST]: { data: { id: "L1", tasks: [makeTask({ id: "t1", priority: "Default" })] } } },
  });
  await useTaskListStore.getState().setPriority(LIST, "t1", "Important");
  listDisk.written.length = 0;
}

function priorityOfT1(): string | undefined {
  return useTaskListStore.getState().files[LIST]?.data.tasks[0]?.priority;
}

describe("a task-list write that fails outright", () => {
  it("holds the close, names the list, and retries the change on request", async () => {
    await mountHarness();
    await seedList();
    listDisk.fail = true;
    // The change is still on its way when the quit starts.
    void useTaskListStore.getState().setPriority(LIST, "t1", "Critical");
    const closing = prepareWindowClose();

    await waitForDialog();
    const dialog = useDialogStore.getState().current;
    expect(dialog?.title.key).toBe("dialog.notSaved.title");
    expect(dialog?.body.values).toEqual({ paths: LIST });
    expect(dialog?.confirmLabel.key).toBe("dialog.notSaved.quitAnyway");
    expect(dialog?.kind === "confirm" && dialog.cancelLabel.key).toBe("dialog.notSaved.retry");
    // Rolled back in memory, as any failed write is.
    expect(priorityOfT1()).toBe("Important");

    // Retry with the volume still failing asks again.
    useDialogStore.getState().cancelCurrent();
    await waitForDialog();
    expect(useDialogStore.getState().current?.body.values).toEqual({ paths: LIST });

    // Retry once the volume takes writes again saves the change and closes.
    listDisk.fail = false;
    useDialogStore.getState().cancelCurrent();
    await expect(closing).resolves.toBe(true);
    expect(listDisk.written).toEqual([`${LIST}:Critical`]);
    expect(priorityOfT1()).toBe("Critical");
  });

  it("closes when the user quits anyway", async () => {
    await mountHarness();
    await seedList();
    listDisk.fail = true;
    void useTaskListStore.getState().setPriority(LIST, "t1", "Critical");
    const closing = prepareWindowClose();

    await waitForDialog();
    useDialogStore.getState().confirmCurrent();

    await expect(closing).resolves.toBe(true);
    expect(listDisk.written).toEqual([]);
  });

  it("does not hold a close for a failure reported before it", async () => {
    await mountHarness();
    await seedList();
    listDisk.fail = true;
    await useTaskListStore.getState().setPriority(LIST, "t1", "Critical");

    await requestClose();

    expect(useDialogStore.getState().current).toBeNull();
    expect(windowStub.events).toEqual(["destroy"]);
  });

  it("is named in the same dialog as drafts that failed", async () => {
    await mountHarness();
    await seedList();
    listDisk.fail = true;
    failDraftWrites = true;
    useNoteDraftStore.getState().setDraft("t1", "typed on a full disk");
    void useTaskListStore.getState().setPriority(LIST, "t1", "Critical");
    const closing = prepareWindowClose();

    await waitForDialog();
    expect(useDialogStore.getState().current?.body.values).toEqual({
      paths: `${LIST}\n${DRAFTS_PATH}`,
    });
    expect(useDialogStore.getState().queue).toEqual([]);
    useDialogStore.getState().confirmCurrent();
    await expect(closing).resolves.toBe(true);
  });
});
