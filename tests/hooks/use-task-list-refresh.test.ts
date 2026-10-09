// @vitest-environment happy-dom
//
// Open lists are re-read as the user returns to them: activating a list's tab
// re-reads that list, activating the unified view or focusing the window
// re-reads every loaded list, and a list not loaded yet is left to its load.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, act } from "react";
import { mount } from "../helpers/react-dom";

const focus = vi.hoisted(() => ({
  listener: null as ((event: { payload: boolean }) => void) | null,
  stopped: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (listener: (event: { payload: boolean }) => void) => {
      focus.listener = listener;
      return () => {
        focus.stopped += 1;
      };
    },
  }),
}));

import { useTaskListRefresh } from "../../src/hooks/useTaskListRefresh";
import { useTaskListStore } from "../../src/state/task-list-store";

type Tab = { filePath: string; isUnifiedView: boolean };

function Harness({ tab }: { tab: Tab | null }) {
  useTaskListRefresh(tab);
  return null;
}

const refreshed: string[] = [];

beforeEach(() => {
  refreshed.length = 0;
  focus.listener = null;
  focus.stopped = 0;
  useTaskListStore.setState({
    files: {
      "/a.json": { data: { id: "A", tasks: [] } },
      "/b.json": { data: { id: "B", tasks: [] } },
    },
    refreshFromDisk: async (path: string) => {
      refreshed.push(path);
    },
  });
});

const list = (filePath: string): Tab => ({ filePath, isUnifiedView: false });
const unified: Tab = { filePath: "", isUnifiedView: true };

describe("useTaskListRefresh", () => {
  it("re-reads the list whose tab is activated", async () => {
    const view = await mount(createElement(Harness, { tab: list("/a.json") }));
    expect(refreshed).toEqual(["/a.json"]);
    await view.unmount();
  });

  it("re-reads every loaded list when the unified view is activated", async () => {
    const view = await mount(createElement(Harness, { tab: unified }));
    expect(refreshed.sort()).toEqual(["/a.json", "/b.json"]);
    await view.unmount();
  });

  it("leaves a list that is not loaded yet to its load", async () => {
    const view = await mount(createElement(Harness, { tab: list("/new.json") }));
    expect(refreshed).toEqual([]);
    await view.unmount();
  });

  it("re-reads every loaded list when the window regains focus, until unmounted", async () => {
    const view = await mount(createElement(Harness, { tab: list("/a.json") }));
    refreshed.length = 0;
    await act(async () => {
      focus.listener?.({ payload: false });
    });
    expect(refreshed).toEqual([]);
    await act(async () => {
      focus.listener?.({ payload: true });
    });
    expect(refreshed.sort()).toEqual(["/a.json", "/b.json"]);
    await view.unmount();
    expect(focus.stopped).toBe(1);
  });
});
