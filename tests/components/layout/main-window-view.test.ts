// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MainWindow } from "../../../src/components/layout/MainWindow";
import { collectViewTasks } from "../../../src/services";
import { createDefaultPreferences, createDefaultWorkspace, createTab } from "../../../src/models";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { taskKey } from "../../../src/utils";
import { makeTask } from "../../helpers/task";
import { mount, type Mounted } from "../../helpers/react-dom";
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: async () => {} }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: async () => {} }) }));
vi.mock("../../../src/services", async (original) => {
  const real = await original<typeof import("../../../src/services")>();
  return { ...real, collectViewTasks: vi.fn(real.collectViewTasks) };
});
let host: Mounted | undefined;
afterEach(async () => { await host?.unmount(); vi.useRealTimers(); });
it("shares one active-view derivation across the window, panes and keyboard", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T23:00:00Z"));
  usePreferencesStore.setState({ preferences: { ...createDefaultPreferences(), timezone: "UTC" } });
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/a", "A")], activeTabIndex: 0 } });
  const data = { id: "list", tasks: [makeTask({ id: "one", title: "One", dueDate: "2026-10-11" })] };
  useTaskListStore.setState({ files: { "/a": { data } }, selectedKeys: new Set(), loadFile: vi.fn(async () => ({ status: "success" as const })), refreshFromDisk: vi.fn(async () => {}) });
  vi.mocked(collectViewTasks).mockClear();
  host = await mount(createElement(MainWindow, { onChromeHeightChange: () => {} }));
  expect(collectViewTasks).toHaveBeenCalledTimes(1);
  await act(async () => useTaskListStore.getState().setSelection(new Set([taskKey("/a", "one")])));
  expect(collectViewTasks).toHaveBeenCalledTimes(1);
  await act(async () => useTaskListStore.setState({ files: { "/a": { data: { ...data, tasks: [...data.tasks, makeTask({ id: "two", title: "Two" })] } } } }));
  expect(collectViewTasks).toHaveBeenCalledTimes(2);
  await act(async () => usePreferencesStore.setState({ preferences: { ...usePreferencesStore.getState().preferences, timezone: "Asia/Tokyo" } }));
  expect(collectViewTasks).toHaveBeenCalledTimes(3);
  expect(vi.mocked(collectViewTasks).mock.results.at(-1)?.value[0].group).toBe("DueToday");
});

it("adjusts the main divider within its displayed bounds and persists once on release or blur", async () => {
  const { useAppStateStore } = await import("../../../src/state/app-state-store");
  const { createDefaultAppState } = await import("../../../src/models");
  const original = useAppStateStore.getState().updateViewState;
  const updateViewState = vi.fn(async (changes) => useAppStateStore.setState((state) => ({ appState: { ...state.appState, ...changes } })));
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  useAppStateStore.setState({ appState: createDefaultAppState(), updateViewState });
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab("/a", "A")], activeTabIndex: 0 } });
  useTaskListStore.setState({ files: { "/a": { data: { id: "list", tasks: [] } } }, selectedKeys: new Set(), loadFile: vi.fn(async () => ({ status: "success" as const })), refreshFromDisk: vi.fn(async () => {}) });
  try {
    host = await mount(createElement(MainWindow, { onChromeHeightChange: () => {} }));
    const divider = document.querySelector<HTMLElement>('[role="separator"]')!;
    const press = async (key: string) => act(async () => { divider.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    divider.focus();
    expect(document.activeElement).toBe(divider);
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    const initial = Number(divider.getAttribute("aria-valuenow"));
    await press("ArrowRight"); await press("ArrowRight");
    expect(Number(divider.getAttribute("aria-valuenow"))).toBe(initial + 32);
    expect(updateViewState).not.toHaveBeenCalled();
    await act(async () => { divider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })); });
    expect(updateViewState).toHaveBeenCalledExactlyOnceWith({ sidebarWidth: initial + 32 });
    await press("End"); await press("ArrowRight");
    expect(divider.getAttribute("aria-valuenow")).toBe(divider.getAttribute("aria-valuemax"));
    await press("Home"); await press("ArrowLeft");
    const minimum = Number(divider.getAttribute("aria-valuemin"));
    expect(Number(divider.getAttribute("aria-valuenow"))).toBe(minimum);
    await act(async () => divider.blur());
    expect(updateViewState).toHaveBeenLastCalledWith({ sidebarWidth: minimum });
    expect(updateViewState).toHaveBeenCalledTimes(2);
  } finally {
    width.mockRestore();
    useAppStateStore.setState({ updateViewState: original });
  }
});
