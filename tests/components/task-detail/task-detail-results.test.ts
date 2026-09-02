// @vitest-environment happy-dom

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
  usePreferencesStore.setState({ preferences: createDefaultPreferences("Test") });
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Test") });
  useNoteDraftStore.setState({ drafts: {}, filePath: "", loaded: true });
  useTaskListStore.setState({
    setStatus,
    sendToFirst,
    setNoteActionability,
    updateTitle,
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
    updateTitle.mockResolvedValueOnce({ status: "error", message: "Title write failed" });
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
      "Title write failed",
    );
  });

  it("keeps a failed status change with the Status field", async () => {
    setStatus.mockResolvedValueOnce({ status: "error", message: "Disk full" });
    const status = [...document.querySelectorAll("select")].find(
      (select) => select.previousElementSibling?.textContent === "Status",
    )!;

    await act(async () => {
      status.value = "Dismissed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(status.getAttribute("aria-invalid")).toBe("true");
    const errorId = status.getAttribute("aria-describedby")!;
    expect(document.getElementById(errorId)?.textContent).toBe("Disk full");
    expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
  });

  it("keeps a reorder failure in the task detail pane", async () => {
    sendToFirst.mockResolvedValueOnce({ status: "error", message: "Permission denied" });
    const tackle = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Tackle",
    )!;

    await act(async () => tackle.click());

    const alert = [...document.querySelectorAll('[role="alert"]')].find(
      (element) => element.textContent?.includes("Task could not be reordered"),
    );
    expect(alert?.textContent).toContain("Permission denied");
  });

  it("keeps a note failure on the affected note", async () => {
    await host?.unmount();
    setNoteActionability.mockResolvedValueOnce({
      status: "error",
      message: "Note write failed",
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
    expect(alert?.textContent).toContain("Note write failed");
    expect(noteSelect.parentElement?.parentElement?.contains(alert ?? null)).toBe(true);
  });
});
