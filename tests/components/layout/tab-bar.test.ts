// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../src/repositories", () => ({
  openJsonFileDialog: vi.fn(),
  saveJsonFileDialog: vi.fn(),
  showMessage: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: (error: unknown) => ({ error: { message: String(error) } }),
}));

import { TabBar } from "../../../src/components/layout/TabBar";
import {
  createDefaultAppState,
  createDefaultPreferences,
  createDefaultWorkspace,
  createTab,
} from "../../../src/models";
import { useAppStateStore } from "../../../src/state/app-state-store";
import { usePreferencesStore } from "../../../src/state/preferences-store";
import { useTaskListStore } from "../../../src/state/task-list-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
});

describe("TabBar wrapped visibility", () => {
  it("renders every open tab in the tablist when there are many tabs", async () => {
    const openTabs = Array.from({ length: 16 }, (_, index) =>
      createTab(`/fixtures/list-${index}.json`, `List ${index}`),
    );
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs,
        activeTabIndex: 0,
      },
      filePath: "",
      loaded: true,
    });
    usePreferencesStore.setState({
      preferences: createDefaultPreferences("Test"),
      filePath: "",
      loaded: true,
    });
    useAppStateStore.setState({
      appState: createDefaultAppState(),
      filePath: "",
      loaded: true,
    });
    useTaskListStore.setState({ files: {}, fileLoadErrors: {} });

    host = await mount(createElement(TabBar, { onMenuSelect: vi.fn() }));

    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) throw new Error("tablist not found");
    const tabRow = tablist.parentElement;
    if (!tabRow) throw new Error("tab row not found");
    const renderedTabs = [...tablist.querySelectorAll('[role="tab"]')];

    expect(tabRow.classList.contains("flex-wrap")).toBe(true);
    expect(tablist.classList.contains("contents")).toBe(true);
    expect(tablist.classList.contains("overflow-x-auto")).toBe(false);
    expect(renderedTabs).toHaveLength(openTabs.length);
    expect(renderedTabs.map((tab) => tab.textContent?.trim())).toEqual(
      openTabs.map((tab) => tab.displayName),
    );
    expect(renderedTabs.every((tab) => !tab.hasAttribute("hidden"))).toBe(true);
  });
});
