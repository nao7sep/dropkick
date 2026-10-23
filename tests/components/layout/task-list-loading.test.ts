// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { MainWindow } from "../../../src/components/layout/MainWindow";
import { createDefaultWorkspace, createTab } from "../../../src/models";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { mount, type Mounted } from "../../helpers/react-dom";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle: async () => {} }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: async () => {} }) }));
let host: Mounted | undefined;
afterEach(async () => { await host?.unmount(); });

it.each(["success", "missing", "retired"])("distinguishes a held initial read from emptiness through %s settlement", async (outcome) => {
  const path = `/loading-${outcome}.json`;
  let finish!: (result: unknown) => void;
  const read = new Promise((resolve) => { finish = resolve; });
  vi.mocked(invoke).mockImplementation(async (command) => command === "read_json_file_with_hash" ? read : undefined);
  useTaskListStore.setState({ files: {}, fileLoadErrors: {}, fileDiskErrors: {}, selectedKeys: new Set() });
  useWorkspaceStore.setState({ workspace: { ...createDefaultWorkspace("Test"), openTabs: [createTab(path, "List")], activeTabIndex: 0 } });
  host = await mount(createElement(MainWindow, { onChromeHeightChange: () => {} }));
  expect(document.querySelector('[role="listbox"][aria-busy="true"]')?.textContent).toBe("Loading 1 list…");
  expect(document.body.textContent).not.toContain("No tasks yet.");
  expect(document.body.textContent).not.toContain("Total tasks");
  const listbox = document.querySelector<HTMLElement>('[role="listbox"]')!;
  listbox.focus();
  const loading = useTaskListStore.getState().loadFile(path);
  let retiring: Promise<void> | undefined;
  try {
    if (outcome === "retired") {
      await act(async () => {
        useWorkspaceStore.setState({ workspace: createDefaultWorkspace("Empty") });
        retiring = useTaskListStore.getState().unloadFile(path);
      });
    }
    await act(async () => {
      finish(outcome === "missing" ? { status: "missing" } : { status: "success", data: { id: outcome, tasks: [] }, hash: outcome });
      await Promise.all([loading, retiring]);
    });
    expect(document.querySelector('[role="listbox"][aria-busy="true"]')).toBeNull();
    if (outcome === "success") {
      expect(document.activeElement).toBe(listbox);
      expect(document.body.textContent).toContain("No tasks yet.");
      expect(document.body.textContent).toContain("Total tasks");
    } else if (outcome === "missing") {
      expect(document.body.textContent).toContain("could not be found");
      expect(document.body.textContent).not.toContain("No tasks yet.");
      expect(document.body.textContent).not.toContain("Total tasks");
    } else {
      expect(useTaskListStore.getState().files[path]).toBeUndefined();
      expect(document.body.textContent).not.toContain("No tasks yet.");
    }
  } finally {
    finish({ status: "missing" });
    await loading;
    await act(async () => useTaskListStore.getState().unloadFile(path));
  }
});
