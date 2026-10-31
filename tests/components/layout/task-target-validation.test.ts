// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewTaskModal } from "../../../src/components/layout/NewTaskModal";
import { MoveTasksModal } from "../../../src/components/layout/MoveTasksModal";
import {
  createDefaultSettings,
  createDefaultWorkspace,
  createTab,
  type Task,
} from "../../../src/models";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useSettingsStore } from "../../../src/state/settings-store";
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
    useSettingsStore.setState({ settings: createDefaultSettings() });
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
  useSettingsStore.setState({ settings: createDefaultSettings() });
  let finish!: (result: { status: "success" }) => void;
  const addNewTask = vi.fn(() => new Promise<{ status: "success" }>((resolve) => { finish = resolve; }));
  const onClose = vi.fn(); useTaskListStore.setState({ addNewTask });
  host = await mount(createElement(NewTaskModal, { currentFilePath: "/one.json", isUnifiedView: false, onClose }));
  await act(async () => typeInto(titleField(), "Pay invoice"));
  const create = [...document.querySelectorAll("button")].find((button) => button.textContent === "Create")!;
  await act(async () => { create.click(); create.click(); });
  expect(addNewTask).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>("textarea,select")].every((field) => field.disabled)).toBe(true);
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish({ status: "success" }));
  expect(onClose).toHaveBeenCalledOnce();
});

// A task needs a title. Create stays unavailable without one, and the keyboard
// submit names the missing field instead of adding an untitled task.
it("refuses a New Task without a title and says so at the title field", async () => {
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/one.json", "One")] } });
  useSettingsStore.setState({ settings: createDefaultSettings() });
  const addNewTask = vi.fn(async () => ({ status: "success" as const }));
  useTaskListStore.setState({ addNewTask });
  host = await mount(createElement(NewTaskModal, { currentFilePath: "/one.json", isUnifiedView: false, onClose: () => undefined }));
  const create = [...document.querySelectorAll("button")].find((button) => button.textContent === "Create")!;
  await act(async () => typeInto(titleField(), "   "));
  expect(create.disabled).toBe(true);
  await act(async () => {
    titleField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(addNewTask).not.toHaveBeenCalled();
  const field = titleField();
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById(field.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a title for this task.");
  await act(async () => typeInto(field, "Pay invoice"));
  expect(field.getAttribute("aria-invalid")).toBe("false");
  expect(create.disabled).toBe(false);
});

function titleField(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Task title"]')!;
}

function typeInto(field: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
