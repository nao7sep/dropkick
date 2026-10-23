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
