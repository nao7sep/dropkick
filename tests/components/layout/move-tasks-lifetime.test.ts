// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MoveTasksModal } from "../../../src/components/layout/MoveTasksModal";
import { createDefaultWorkspace, createTab, type Task } from "../../../src/models";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { message } from "../../../src/i18n/translate";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";

type MoveOutcome = Awaited<ReturnType<ReturnType<typeof useTaskListStore.getState>["moveTasks"]>>;
let host: Mounted | undefined;
afterEach(async () => { await host?.unmount(); });

it.each(["success", "error"] as const)("owns dismissal through a held move and exposes %s settlement", async (status) => {
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/a", "A"), createTab("/b", "B")] } });
  let finish!: (result: MoveOutcome) => void;
  const moveTasks = vi.fn(() => new Promise<MoveOutcome>((resolve) => { finish = resolve; }));
  useTaskListStore.setState({ moveTasks });
  const onClose = vi.fn();
  const task: Task = { ...makeTask({ id: "one", title: "One" }), sourceFile: "/a", hasActionableNotes: false, canComplete: true, isOverdue: false, isDueToday: false, group: "Default" };
  host = await mount(createElement(MoveTasksModal, { selectedTasks: [task], sourceFilePath: "/a", isUnifiedView: false, nextActiveTaskKey: null, onClose }));
  const select = document.querySelector("select")!;
  await act(async () => { select.value = "/b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const button = (text: string) => [...document.querySelectorAll("button")].find((node) => node.textContent === text)!;
  await act(async () => { button("Move").click(); button("Move").click(); });
  expect(moveTasks).toHaveBeenCalledOnce();
  expect(select.disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('button[aria-label]')!.disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Moving tasks…");
  await act(async () => {
    button("Cancel").click();
    document.querySelector<HTMLButtonElement>('button[aria-label]')!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true, cancelable: true }));
    document.body.click();
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish(status === "error" ? { status, message: message("write.taskList") } : { status }));
  if (status === "success") expect(onClose).toHaveBeenCalledOnce();
  else {
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(select.disabled).toBe(false);
    await act(async () => { button("Cancel").click(); });
    expect(onClose).toHaveBeenCalledOnce();
  }
});
