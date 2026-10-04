// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../helpers/react-dom";

const watch = vi.hoisted(() => ({
  listener: null as ((path: string) => void) | null,
}));

vi.mock("../../src/repositories", () => ({
  onFileChanged: (listener: (path: string) => void) => {
    watch.listener = listener;
    return () => {
      watch.listener = null;
    };
  },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useTaskListFileWatch } from "../../src/hooks/useTaskListFileWatch";
import { useTaskListStore } from "../../src/state/task-list-store";

const refreshFromDisk = vi.fn(async (_path: string) => {});

function Host() {
  useTaskListFileWatch();
  return null;
}

let mounted: Mounted | null = null;

beforeEach(async () => {
  vi.useFakeTimers();
  refreshFromDisk.mockClear();
  useTaskListStore.setState({ refreshFromDisk });
  mounted = await mount(createElement(Host));
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

const change = (path: string) => act(() => watch.listener?.(path));

describe("useTaskListFileWatch", () => {
  it("reads a list back once per burst of changes, after the burst settles", async () => {
    await change("/a.json");
    await change("/a.json");
    vi.advanceTimersByTime(200);
    await change("/a.json");
    expect(refreshFromDisk).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(refreshFromDisk.mock.calls).toEqual([["/a.json"]]);
  });

  it("settles each list on its own", async () => {
    await change("/a.json");
    vi.advanceTimersByTime(200);
    await change("/b.json");
    vi.advanceTimersByTime(100);
    expect(refreshFromDisk.mock.calls).toEqual([["/a.json"]]);
    vi.advanceTimersByTime(200);
    expect(refreshFromDisk.mock.calls).toEqual([["/a.json"], ["/b.json"]]);
  });

  it("stops listening and drops a pending read when the window goes", async () => {
    await change("/a.json");
    await mounted?.unmount();
    mounted = null;
    vi.advanceTimersByTime(1000);
    expect(watch.listener).toBeNull();
    expect(refreshFromDisk).not.toHaveBeenCalled();
  });
});
