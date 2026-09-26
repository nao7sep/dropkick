// @vitest-environment happy-dom

import { message } from "../../../src/i18n/translate";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../src/models";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
} from "../../../src/models";
import { TaskDetail } from "../../../src/components/task-detail/TaskDetail";
import { useNoteDraftStore } from "../../../src/state/note-draft-store";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeNote, makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

const setStatus = vi.fn();
const sendToFirst = vi.fn();
const setNoteActionability = vi.fn();
const updateTitle = vi.fn();
const updateDescription = vi.fn();
const addNewNote = vi.fn();
let host: Mounted | null = null;

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

beforeEach(async () => {
  setStatus.mockReset().mockResolvedValue({ status: "success" });
  sendToFirst.mockReset().mockResolvedValue({ status: "success", changed: true });
  setNoteActionability.mockReset().mockResolvedValue({ status: "success" });
  updateTitle.mockReset().mockResolvedValue({ status: "success" });
  updateDescription.mockReset().mockResolvedValue({ status: "success" });
  addNewNote.mockReset().mockResolvedValue({ status: "success" });
  usePreferencesStore.setState({ preferences: createDefaultPreferences("Test") });
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Test") });
  useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: true });
  useTaskListStore.setState({
    setStatus,
    sendToFirst,
    setNoteActionability,
    updateTitle,
    updateDescription,
    addNewNote,
    selectedKeys: new Set(["/one.json\u0000task-a"]),
  });
  host = await mount(
    createElement(TaskDetail, {
      task: task(),
      filePath: "/one.json",
      isUnifiedView: false,
      nextActiveTaskKey: null,
      focusNewNoteSignal: 0,
    }),
  );
});

afterEach(async () => {
  await host?.unmount();
  host = null;
});

describe("TaskDetail operation results", () => {
  it("retains a failed title draft beside its field for retry", async () => {
    updateTitle.mockResolvedValueOnce({ status: "error", message: message("write.taskList") });
    const title = document.querySelector('textarea[placeholder="Task title..."]')! as HTMLTextAreaElement;

    await act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(title, "Retained title");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(title.value).toBe("Retained title");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(title.getAttribute("aria-describedby")!)?.textContent).toBe(
      "The task list could not be saved. Your change was not saved; try again.",
    );
  });

  it("keeps a failed status change with the Status field", async () => {
    setStatus.mockResolvedValueOnce({ status: "error", message: message("write.fileGone") });
    const status = [...document.querySelectorAll("select")].find(
      (select) => select.previousElementSibling?.textContent === "Status",
    )!;

    await act(async () => {
      status.value = "Dismissed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(status.getAttribute("aria-invalid")).toBe("true");
    const errorId = status.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)?.textContent).toBe(
      "The file no longer exists. Your in-app change was not saved.",
    );
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("keeps a reorder failure in the task detail pane", async () => {
    sendToFirst.mockResolvedValueOnce({ status: "error", message: message("write.notLoaded") });
    const tackle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Tackle",
    )!;

    await act(async () => tackle.click());

    const alert = [...document.querySelectorAll('[role="alert"]')].find(
      (element) => element.textContent?.includes("Task could not be reordered"),
    );
    expect(alert?.textContent).toContain("no longer loaded");
  });

  it("keeps a note failure on the affected note", async () => {
    await host?.unmount();
    setNoteActionability.mockResolvedValueOnce({
      status: "reloaded",
      message: message("write.reloaded"),
    });
    host = await mount(
      createElement(TaskDetail, {
        task: { ...task(), notes: [makeNote({ id: "note-a" })] },
        filePath: "/one.json",
        isUnifiedView: false,
        nextActiveTaskKey: null,
        focusNewNoteSignal: 0,
      }),
    );
    const noteSelect = [...document.querySelectorAll("select")].find(
      (select) => select.value === "Informational",
    )!;

    await act(async () => {
      noteSelect.value = "Actionable";
      noteSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const alert = [...document.querySelectorAll('[role="alert"]')].find(
      (element) => element.textContent?.includes("Note could not be updated"),
    );
    expect(alert?.textContent).toContain("reloaded from disk");
    expect(noteSelect.parentElement?.parentElement?.contains(alert ?? null)).toBe(true);
  });
});

function typeInto(field: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
    field,
    value,
  );
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function showTask(): Promise<void> {
  await host?.unmount();
  host = await mount(
    createElement(TaskDetail, {
      task: task(),
      filePath: "/one.json",
      isUnifiedView: false,
      nextActiveTaskKey: null,
      focusNewNoteSignal: 0,
    }),
  );
}

describe("TaskDetail title and description drafts", () => {
  it("holds typed title and description text in the draft store before any blur", async () => {
    const title = document.querySelector('textarea[placeholder="Task title..."]')! as HTMLTextAreaElement;
    const description = document.querySelector(
      'textarea[placeholder="Add a description..."]',
    )! as HTMLTextAreaElement;

    await act(async () => {
      title.focus();
      typeInto(title, "Alpha, renamed");
    });
    expect(useNoteDraftStore.getState().drafts["task-a#title"]).toBe("Alpha, renamed");
    await act(async () => {
      description.focus();
      typeInto(description, "Typed and never blurred");
    });

    expect(useNoteDraftStore.getState().drafts).toMatchObject({
      "task-a#description": "Typed and never blurred",
    });
  });

  it("commits a title and description left from a quit when the task is shown", async () => {
    useNoteDraftStore.setState({
      drafts: {
        "task-a#title": "Typed before quitting",
        "task-a#description": "Also typed before quitting",
      },
    });

    await showTask();

    expect(updateTitle).toHaveBeenCalledWith("/one.json", "task-a", "Typed before quitting");
    expect(updateDescription).toHaveBeenCalledWith(
      "/one.json",
      "task-a",
      "Also typed before quitting",
    );
    expect(useNoteDraftStore.getState().drafts).toEqual({});
  });

  it("drops a description draft when the conflict is answered with Reload", async () => {
    updateDescription.mockResolvedValueOnce({
      status: "reloaded",
      message: message("write.reloaded"),
    });
    const description = document.querySelector(
      'textarea[placeholder="Add a description..."]',
    )! as HTMLTextAreaElement;
    await act(async () => {
      description.focus();
      typeInto(description, "Discarded by Reload");
    });
    await act(async () => {
      description.blur();
    });

    expect(useNoteDraftStore.getState().drafts["task-a#description"]).toBeUndefined();
    expect(description.value).toBe("");
    expect(document.getElementById(description.getAttribute("aria-describedby")!)?.textContent)
      .toContain("reloaded from disk");

    updateDescription.mockClear();
    await showTask();
    expect(updateDescription).not.toHaveBeenCalled();
  });

  it("drops a title draft left from a quit when its commit is answered with Reload", async () => {
    updateTitle.mockResolvedValueOnce({
      status: "reloaded",
      message: message("write.reloaded"),
    });
    useNoteDraftStore.setState({ drafts: { "task-a#title": "Typed before quitting" } });

    await showTask();
    expect(updateTitle).toHaveBeenCalledTimes(1);
    expect(useNoteDraftStore.getState().drafts).toEqual({});

    await showTask();
    expect(updateTitle).toHaveBeenCalledTimes(1);
  });

  it("commits the title on blur and then drops its draft", async () => {
    const title = document.querySelector('textarea[placeholder="Task title..."]')! as HTMLTextAreaElement;
    await act(async () => {
      title.focus();
      typeInto(title, "Blurred title");
    });
    await act(async () => {
      title.blur();
    });

    expect(updateTitle).toHaveBeenCalledWith("/one.json", "task-a", "Blurred title");
    expect(useNoteDraftStore.getState().drafts["task-a#title"]).toBeUndefined();
  });
});

describe("TaskDetail note composer", () => {
  it("adds a note once however often Add is clicked while the write runs", async () => {
    let finish!: (value: { status: "success" }) => void;
    addNewNote.mockImplementationOnce(
      () => new Promise((resolve) => {
        finish = resolve;
      }),
    );
    useNoteDraftStore.setState({ drafts: { "task-a": "One note" } });
    await showTask();
    const add = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Add Note",
    )!;

    await act(async () => {
      add.click();
      add.click();
    });
    await act(async () => {
      finish({ status: "success" });
    });

    expect(addNewNote).toHaveBeenCalledTimes(1);
  });
});

describe("TaskDetail note editor", () => {
  it("closes onto the disk note when its save is answered with Reload", async () => {
    const updateNote = vi.fn().mockResolvedValue({
      status: "reloaded",
      message: message("write.reloaded"),
    });
    useTaskListStore.setState({ updateNote });
    useNoteDraftStore.setState({ drafts: { "task-a:note-a": "Discarded by Reload" } });
    await host?.unmount();
    host = await mount(
      createElement(TaskDetail, {
        task: { ...task(), notes: [makeNote({ id: "note-a", content: "On disk" })] },
        filePath: "/one.json",
        isUnifiedView: false,
        nextActiveTaskKey: null,
        focusNewNoteSignal: 0,
      }),
    );
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    )!;

    await act(async () => save.click());

    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(useNoteDraftStore.getState().drafts["task-a:note-a"]).toBeUndefined();
    expect(document.body.textContent).toContain("On disk");
    expect(document.body.textContent).toContain("reloaded from disk");
  });
});
