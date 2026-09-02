// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../src/models";
import {
  createDefaultPreferences,
  createDefaultWorkspace,
} from "../../../src/models";
import { BulkActions } from "../../../src/components/task-detail/BulkActions";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

const setStatus = vi.fn();
let host: Mounted | null = null;

function task(id: string, title: string): Task {
  return {
    ...makeTask({ id, title }),
    sourceFile: "/one.json",
    hasActionableNotes: false,
    canComplete: true,
    isOverdue: false,
    isDueToday: false,
    group: "Default",
  };
}

beforeEach(async () => {
  setStatus
    .mockReset()
    .mockResolvedValueOnce({ status: "success" })
    .mockResolvedValueOnce({ status: "validation", reason: "Has actionable notes" });
  usePreferencesStore.setState({ preferences: createDefaultPreferences("Test") });
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Test") });
  useTaskListStore.setState({ setStatus });
  host = await mount(
    createElement(BulkActions, {
      selectedTasks: [task("a", "Alpha"), task("b", "Beta")],
      filePath: "/one.json",
      isUnifiedView: false,
      nextActiveTaskKey: null,
    }),
  );
});

afterEach(async () => {
  await host?.unmount();
  host = null;
});

describe("BulkActions results", () => {
  it("enumerates each affected task in the surviving bulk surface", async () => {
    const completed = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Completed",
    )!;
    await act(async () => completed.click());

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Some tasks were not updated");
    expect(alert?.textContent).toContain("Beta: Has actionable notes");
    expect(alert?.textContent).not.toContain("Alpha:");
  });
});
