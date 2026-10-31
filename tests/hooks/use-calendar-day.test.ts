// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useViewTasks } from "../../src/hooks/useViewTasks";
import { useTaskListStore } from "../../src/state/task-list-store";
import { useSettingsStore } from "../../src/state/settings-store";
import { createDefaultSettings } from "../../src/models";
import { makeTask } from "../helpers/task";
import { mount, type Mounted } from "../helpers/react-dom";
let host: Mounted | undefined;
afterEach(async () => { await host?.unmount(); host = undefined; vi.useRealTimers(); });
function View() { return createElement("div", null, useViewTasks("/list.json", false).tasks[0]?.group); }
it("updates an unchanged task view overnight and when returning after suspension", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T23:59:59Z"));
  const files = { "/list.json": { data: { id: "list", tasks: [makeTask({ dueDate: "2026-10-11" })] } } };
  useTaskListStore.setState({ files });
  useSettingsStore.setState({ settings: { ...createDefaultSettings(), timezone: "UTC" } });
  host = await mount(createElement(View)); expect(document.body.textContent).toBe("DueSoon");
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(document.body.textContent).toBe("DueToday");
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(document.body.textContent).toBe("PastDue");
  expect(useTaskListStore.getState().files).toBe(files);
});
