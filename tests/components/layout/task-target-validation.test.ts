// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTaskModal } from "../../../src/components/layout/NewTaskModal";
import { MoveTasksModal } from "../../../src/components/layout/MoveTasksModal";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
  createTab,
  type Task,
} from "../../../src/models";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

let host: Mounted | null = null;

afterEach(async () => {
  await host?.unmount();
  host = null;
});

function task(): Task {
  return {
    ...makeTask({ id: "task-a", title: "Alpha" }),
    sourceFile: "/one.json",
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: "Default",
  };
}

describe("task target validation", () => {
  it("associates the New Task target with its visible error", async () => {
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs: [createTab("/one.json", "One")],
        activeTabIndex: 0,
      },
    });
    usePreferencesStore.setState({ preferences: createDefaultPreferences() });
    host = await mount(
      createElement(NewTaskModal, {
        currentFilePath: "",
        isUnifiedView: true,
        onClose: () => undefined,
      }),
    );

    await act(async () => {
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });

    const select = document.querySelector("select")!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const errorId = select.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)?.textContent).toContain("Select the task list");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("associates the Move Tasks destination with its visible error", async () => {
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs: [
          createTab("/one.json", "One"),
          createTab("/two.json", "Two"),
        ],
        activeTabIndex: 0,
      },
    });
    host = await mount(
      createElement(MoveTasksModal, {
        selectedTasks: [task()],
        sourceFilePath: "/one.json",
        isUnifiedView: false,
        nextActiveTaskKey: null,
        onClose: () => undefined,
      }),
    );

    await act(async () => {
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });

    const select = document.querySelector("select")!;
    expect(select.getAttribute("aria-invalid")).toBe("true");
    const errorId = select.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)?.textContent).toContain("Select the task list");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });
});


it("holds the submitted New Task fields and close paths until settlement", async () => {
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/one.json", "One")] } });
  usePreferencesStore.setState({ preferences: createDefaultPreferences() });
  let finish!: (result: { status: "success" }) => void;
  const addNewTask = vi.fn(() => new Promise<{ status: "success" }>((resolve) => { finish = resolve; }));
  const onClose = vi.fn(); useTaskListStore.setState({ addNewTask });
  host = await mount(createElement(NewTaskModal, { currentFilePath: "/one.json", isUnifiedView: false, onClose }));
  const create = [...document.querySelectorAll("button")].find((button) => button.textContent === "Create")!;
  await act(async () => { create.click(); create.click(); });
  expect(addNewTask).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>("textarea,select")].every((field) => field.disabled)).toBe(true);
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish({ status: "success" }));
  expect(onClose).toHaveBeenCalledOnce();
});
