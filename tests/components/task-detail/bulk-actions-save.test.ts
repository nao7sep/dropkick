// @vitest-environment happy-dom
// Exercise the pointer action through the actual store mutation owner.
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import { BulkActions } from "../../../src/components/task-detail/BulkActions";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useSettingsStore } from "../../../src/state/settings-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { createDefaultSettings, createDefaultWorkspace } from "../../../src/models";
import { toTask } from "../../../src/utils/domain-mapping";
import { makeTask } from "../../helpers/task";
import { mount } from "../../helpers/react-dom";
const flush = vi.hoisted(() => vi.fn(async (_path: string, data: () => unknown) => { data(); return { status: "success" }; }));
vi.mock("../../../src/repositories", () => ({ flushTaskList: flush, log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
it("a pointer bulk priority action saves once per changed list, including a large selection", async () => {
  const first = Array.from({ length: 50 }, (_, index) => makeTask({ id: `first-${index}` }));
  const second = Array.from({ length: 25 }, (_, index) => makeTask({ id: `second-${index}` }));
  useTaskListStore.setState({ files: { "/a.json": { data: { id: "A", tasks: first } }, "/b.json": { data: { id: "B", tasks: second } } }, unsavedFiles: {} });
  useSettingsStore.setState({ settings: createDefaultSettings() });
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Test") });
  const selectedTasks = [...first.map((task) => toTask(task, "/a.json", "UTC", 7)), ...second.map((task) => toTask(task, "/b.json", "UTC", 7))];
  const host = await mount(createElement(BulkActions, { selectedTasks, filePath: "", isUnifiedView: true, nextActiveTaskKey: null }));
  try {
    const urgent = [...document.querySelectorAll("button")].find((button) => button.textContent === "Urgent")!;
    await act(async () => urgent.click());
    expect(flush.mock.calls.map(([path]) => path).sort()).toEqual(["/a.json", "/b.json"]);
    expect(Object.values(useTaskListStore.getState().files).flatMap((file) => file.data.tasks).every((task) => task.priority === "Urgent")).toBe(true);
  } finally { await host.unmount(); }
});
