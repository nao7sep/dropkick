// @vitest-environment happy-dom
//
// The quit wiring — the seam the previous suite never reached, which is where
// both defects on this path lived. Two properties matter here:
//
//   1. The graceful close gets the last keystrokes onto disk BEFORE the window
//      is destroyed, so the coalescing window costs nothing on the one exit
//      this handler can actually see.
//   2. It asks nothing. The old design held drafts in memory and prompted here;
//      that prompt could not run on macOS Cmd+Q (tao emits CloseRequested only
//      from `windowShouldClose:`), so it protected nothing while nagging on the
//      exits it did reach. Drafts are written through now, and a dialog raised
//      here would be a regression, not caution.

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
import { useWindowClose } from "../../src/hooks/use-window-close";
import { useNoteDraftStore, flushNoteDraftsNow } from "../../src/state/note-draft-store";
import { useDialogStore } from "../../src/state/dialog-store";

const invokeMock = invoke as unknown as Mock;
const DRAFTS_PATH = "/home/u/.dropkick/note-drafts.json";

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

  useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: false });
  await flushNoteDraftsNow();
  useDialogStore.setState({ current: null, queue: [] });

  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args: unknown) => {
    if (
      cmd === "write_text_file_atomic" &&
      (args as { path: string }).path === DRAFTS_PATH
    ) {
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
      'write:{"version":"1.0.0","drafts":{"t1":"typedasecondago"}}',
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
