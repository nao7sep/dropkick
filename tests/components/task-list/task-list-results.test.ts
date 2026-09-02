// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
  createTab,
} from "../../../src/models";
import { TaskListPane } from "../../../src/components/task-list/TaskListPane";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

const updateTitle = vi.fn();
let host: Mounted | null = null;

beforeEach(async () => {
  updateTitle.mockReset().mockResolvedValue({
    status: "error",
    message: "Disk full",
  });
  usePreferencesStore.setState({ preferences: createDefaultPreferences("Test") });
  useWorkspaceStore.setState({
    workspace: {
      ...createDefaultWorkspace("Test"),
      openTabs: [createTab("/one.json", "One")],
      activeTabIndex: 0,
    },
  });
  useTaskListStore.setState({
    files: {
      "/one.json": {
        data: { version: "1.0.0", id: "list-one", tasks: [makeTask({ id: "a", title: "Alpha" })] },
      },
    },
    fileLoadErrors: {},
    selectedKeys: new Set(),
    updateTitle,
  });
  host = await mount(
    createElement(TaskListPane, {
      filePath: "/one.json",
      isUnifiedView: false,
      onNewTask: () => undefined,
    }),
  );
});

afterEach(async () => {
  await host?.unmount();
  host = null;
});

describe("TaskListPane results", () => {
  it("retains a failed rename and its explanation in the affected row", async () => {
    const row = document.querySelector('[role="option"]')! as HTMLElement;
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = row.querySelector("input")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Renamed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      row
        .querySelector("input")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(updateTitle).toHaveBeenCalled();
    expect(row.querySelector("input")).not.toBeNull();
    expect(row.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
    expect(row.querySelector('[role="alert"]')?.textContent).toBe("Disk full");
  });
});
