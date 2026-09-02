// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "../../src/hooks/use-keyboard-shortcuts";
import { createDefaultPreferences } from "../../src/models";
import type { TaskStatus } from "../../src/models";
import { useNoteDraftStore } from "../../src/state/note-draft-store";
import { usePreferencesStore } from "../../src/state/preferences-store";
import { useTaskListStore } from "../../src/state/task-list-store";
import { useWorkspaceStore } from "../../src/state/workspace-store";
import { taskKey } from "../../src/utils";
import { makeTask } from "../helpers/task";
import { mount } from "../helpers/react-dom";
import type { Mounted } from "../helpers/react-dom";

const FILE = "/tasks.json";
const removeTasks = vi.fn();
const setStatus = vi.fn();
const clearTaskDrafts = vi.fn();
const taskActionFailure = vi.fn();
let host: Mounted;

function Harness() {
  useKeyboardShortcuts(
    FILE,
    false,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    taskActionFailure,
  );
  return null;
}

async function press(
  key: string,
  options: KeyboardEventInit = {},
  target: HTMLElement = document.body,
) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...options }),
    );
    await Promise.resolve();
  });
}

beforeEach(async () => {
  removeTasks.mockReset().mockResolvedValue({
    status: "success",
    changed: true,
  });
  setStatus.mockReset().mockResolvedValue({
    status: "success",
    changed: true,
  });
  clearTaskDrafts.mockReset();
  taskActionFailure.mockReset();

  usePreferencesStore.setState({
    preferences: {
      ...createDefaultPreferences("Test"),
      timezone: "UTC",
      confirmPermanentDeletions: false,
    },
  });
  useWorkspaceStore.setState({
    workspace: {
      ...useWorkspaceStore.getState().workspace,
      openTabs: [
        { filePath: FILE, displayName: "Tasks", isUnifiedView: false },
      ],
      activeTabIndex: 0,
    },
  });
  useTaskListStore.setState({
    files: {
      [FILE]: {
        data: {
          version: "1.0.0",
          id: "list",
          tasks: [makeTask({ id: "a", title: "A" })],
        },
      },
    },
    selectedKeys: new Set([taskKey(FILE, "a")]),
    removeTasks,
    setStatus: (
      filePath: string,
      taskId: string,
      status: TaskStatus,
    ) => setStatus(filePath, taskId, status),
  });
  useNoteDraftStore.setState({ clearTaskDrafts });
  host = await mount(createElement(Harness));
});

afterEach(async () => {
  await host.unmount();
});

describe("task deletion dispatch", () => {
  it.each(["Delete", "Backspace"])(
    "%s permanently deletes the selected task",
    async (key) => {
      await press(key);

      expect(removeTasks).toHaveBeenCalledWith(FILE, new Set(["a"]));
      expect(clearTaskDrafts).toHaveBeenCalledWith("a");
      expect(setStatus).not.toHaveBeenCalled();
    },
  );

  it("keeps X as reversible dismissal", async () => {
    await press("x");

    expect(setStatus).toHaveBeenCalledWith(FILE, "a", "Dismissed");
    expect(removeTasks).not.toHaveBeenCalled();
  });

  it("returns a deletion failure to the selected task surface", async () => {
    removeTasks.mockResolvedValueOnce({ status: "error", message: "Disk full" });

    await press("Delete");

    expect(taskActionFailure).toHaveBeenCalledWith(
      [taskKey(FILE, "a")],
      "Tasks could not be deleted",
      "A: Disk full",
    );
  });

  it("leaves Backspace to an editable field", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    await press("Backspace", {}, input);

    expect(removeTasks).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores modified and repeating deletion keys", async () => {
    await press("Delete", { shiftKey: true });
    await press("Backspace", { metaKey: true });
    await press("Delete", { repeat: true });

    expect(removeTasks).not.toHaveBeenCalled();
  });
});
