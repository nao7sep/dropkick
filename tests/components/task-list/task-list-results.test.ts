// @vitest-environment happy-dom

import { message } from "../../../src/i18n/translate";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
  createTab,
} from "../../../src/models";
import { TaskListPane } from "../../../src/components/task-list/TaskListPane";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useNoteDraftStore } from "../../../src/state/note-draft-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

const updateTitle = vi.fn();
let host: Mounted | null = null;

beforeEach(async () => {
  useNoteDraftStore.setState({ drafts: {}, draftVersions: {}, filePath: "", loaded: true });
  updateTitle.mockReset().mockResolvedValue({
    status: "error",
    message: message("write.taskList"),
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
        data: { id: "list-one", tasks: [makeTask({ id: "a", title: "Alpha" })] },
      },
    },
    fileLoadErrors: {},
    fileDiskErrors: {},
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
    expect(row.querySelector('[role="alert"]')?.textContent).toBe(
      "The task list could not be saved. Your change was not saved; try again.",
    );
  });

  it("ends a rename answered with Reload and drops its draft", async () => {
    updateTitle.mockResolvedValueOnce({
      status: "reloaded",
      message: message("write.reloaded"),
    });
    useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: true });
    const row = document.querySelector('[role="option"]')! as HTMLElement;
    await act(async () => row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = row.querySelector("input")!;

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Discarded by Reload");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(updateTitle).toHaveBeenCalledTimes(1);
    expect(row.querySelector("input")).toBeNull();
    expect(useNoteDraftStore.getState().drafts["a#title"]).toBeUndefined();
    expect(row.querySelector('[role="alert"]')?.textContent).toContain("reloaded from disk");
  });

  it("says when the file changed on disk could not be read, above the copy still loaded", async () => {
    await act(async () => {
      useTaskListStore.setState({ fileDiskErrors: { "/one.json": { status: "missing" } } });
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "The task list file could not be found. The list below is the copy Dropkick loaded earlier.",
    );
    expect(document.querySelector('[role="option"]')?.textContent).toContain("Alpha");

    await act(async () => {
      useTaskListStore.setState({ fileDiskErrors: {} });
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("says a failed save left the list unsaved, with the Retry that saves it, until it lands", async () => {
    const retryUnsaved = vi.fn();
    await act(async () => {
      useTaskListStore.setState({
        unsavedFiles: { "/one.json": message("write.taskList") },
        retryUnsaved,
      });
    });
    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("The task list could not be saved.");
    expect(document.querySelector('[role="option"]')?.textContent).toContain("Alpha");

    const retry = [...alert.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(retryUnsaved).toHaveBeenCalledWith(["/one.json"]);

    await act(async () => {
      useTaskListStore.setState({ unsavedFiles: {} });
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

it("keeps the rename editor and later draft after a held Reload", async () => {
  let finish!: (value: unknown) => void;
  updateTitle.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const row = document.querySelector('[role="option"]')! as HTMLElement;
  await act(async () => { row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  const input = row.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "A");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await act(async () => {
    useNoteDraftStore.getState().setDraft("a#title", "B");
    useNoteDraftStore.getState().setDraft("a#title", "A");
  });
  await act(async () => { finish({ status: "reloaded", message: message("write.reloaded") }); });
  expect(useNoteDraftStore.getState().drafts["a#title"]).toBe("A");
  expect(row.querySelector("input")?.value).toBe("A");
});
