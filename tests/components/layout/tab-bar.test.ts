// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { Accessibility } from "@dnd-kit/dom";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

const dnd = vi.hoisted(() => ({
  provider: null as Record<string, any> | null,
  sortables: [] as Record<string, unknown>[],
}));

vi.mock("@dnd-kit/react", async () => {
  const ReactModule = await import("react");
  return {
    DragDropProvider: ({ children, ...props }: any) => {
      dnd.provider = props;
      return ReactModule.createElement(ReactModule.Fragment, null, children);
    },
  };
});

vi.mock("@dnd-kit/react/sortable", () => ({
  isSortable: (source: { sortable?: boolean } | null) =>
    source?.sortable === true,
  useSortable: (input: Record<string, unknown>) => {
    dnd.sortables.push(input);
    return { ref: () => undefined, isDragging: false };
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const flushWorkspace = vi.fn(async (_path: string, getWorkspace: () => unknown) => {
  getWorkspace();
});

vi.mock("../../../src/repositories", () => ({
  openJsonFileDialog: vi.fn(),
  saveJsonFileDialog: vi.fn(),
  showMessage: vi.fn(),
  flushWorkspace: (path: string, getWorkspace: () => unknown) =>
    flushWorkspace(path, getWorkspace),
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
let resizeCallback: ResizeObserverCallback;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(async () => {
  await host?.unmount();
  dnd.provider = null;
  dnd.sortables = [];
  useWorkspaceStore.setState({ workspacePersistenceError: null });
  vi.unstubAllGlobals();
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

    const onChromeHeightChange = vi.fn();
    host = await mount(
      createElement(TabBar, { onMenuSelect: vi.fn(), onChromeHeightChange }),
    );

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
    expect(renderedTabs.every((tab) => tab.classList.contains("cursor-grab"))).toBe(true);

    const chrome = tabRow.parentElement;
    if (!chrome) throw new Error("tab chrome not found");
    vi.spyOn(chrome, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 524,
      height: 120,
      top: 0,
      right: 524,
      bottom: 120,
      left: 0,
      toJSON: () => ({}),
    });
    await act(async () => resizeCallback([], {} as ResizeObserver));
    expect(onChromeHeightChange).toHaveBeenLastCalledWith(120);
  });

  it("uses the current sortable seam without taking over tab semantics", async () => {
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs: [
          createTab("/fixtures/a.json", "A"),
          createTab("/fixtures/b.json", "B"),
        ],
        activeTabIndex: 0,
      },
      filePath: "",
      loaded: true,
    });

    host = await mount(
      createElement(TabBar, {
        onMenuSelect: vi.fn(),
        onChromeHeightChange: vi.fn(),
      }),
    );

    const provider = dnd.provider as any;
    expect(provider.sensors).toHaveLength(1);
    expect(
      provider.sensors[0].options.activationConstraints[0].options.value,
    ).toBe(5);

    const retainedPlugin = {};
    expect(provider.plugins([Accessibility, retainedPlugin])).toEqual([
      retainedPlugin,
    ]);
    expect(dnd.sortables).toEqual([
      {
        id: "/fixtures/a.json",
        index: 0,
        type: "workspace-tab",
        accept: "workspace-tab",
        group: "workspace-tab",
      },
      {
        id: "/fixtures/b.json",
        index: 1,
        type: "workspace-tab",
        accept: "workspace-tab",
        group: "workspace-tab",
      },
    ]);
    expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it("maps a completed pointer sort to the durable reorder and ignores cancellation", async () => {
    const openTabs = [
      createTab("/fixtures/a.json", "A"),
      createTab("/fixtures/b.json", "B"),
      createTab("/fixtures/c.json", "C"),
    ];
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs,
        activeTabIndex: 0,
      },
      filePath: "/fixtures/workspace.json",
      loaded: true,
    });
    flushWorkspace.mockClear();

    host = await mount(
      createElement(TabBar, {
        onMenuSelect: vi.fn(),
        onChromeHeightChange: vi.fn(),
      }),
    );
    const provider = dnd.provider as any;
    const operation = {
      source: { sortable: true, initialIndex: 0, index: 2 },
      target: {},
    };

    await act(async () => {
      provider.onDragEnd({ canceled: true, operation });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      useWorkspaceStore.getState().workspace.openTabs.map((tab) => tab.filePath),
    ).toEqual(["/fixtures/a.json", "/fixtures/b.json", "/fixtures/c.json"]);
    expect(flushWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      provider.onDragEnd({ canceled: false, operation });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      useWorkspaceStore.getState().workspace.openTabs.map((tab) => tab.filePath),
    ).toEqual(["/fixtures/b.json", "/fixtures/c.json", "/fixtures/a.json"]);
    expect(useWorkspaceStore.getState().workspace.activeTabIndex).toBe(2);
    expect(flushWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps a workspace persistence error visible until it is dismissed", async () => {
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs: [createTab("/fixtures/a.json", "A")],
        activeTabIndex: 0,
      },
      filePath: "/fixtures/workspace.json",
      loaded: true,
      workspacePersistenceError: "The tab order could not be saved. The previous order was restored.",
    });

    host = await mount(
      createElement(TabBar, {
        onMenuSelect: vi.fn(),
        onChromeHeightChange: vi.fn(),
      }),
    );

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("previous order was restored");
    const dismiss = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss workspace save error"]');
    if (!dismiss) throw new Error("dismiss button not found");
    await act(async () => dismiss.click());

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(useWorkspaceStore.getState().workspacePersistenceError).toBeNull();
  });

  it("moves the focused tab durably while selection and focus follow its stable id", async () => {
    const openTabs = [
      createTab("/fixtures/a.json", "A"),
      createTab("/fixtures/b.json", "B"),
      createTab("/fixtures/c.json", "C"),
    ];
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs,
        activeTabIndex: 1,
      },
      filePath: "/fixtures/workspace.json",
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
    flushWorkspace.mockClear();

    host = await mount(
      createElement(TabBar, {
        onMenuSelect: vi.fn(),
        onChromeHeightChange: vi.fn(),
      }),
    );
    const focused = document.querySelector<HTMLElement>('[data-tab-id="/fixtures/b.json"]');
    if (!focused) throw new Error("focused tab not found");
    focused.focus();

    await act(async () => {
      focused.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(
      useWorkspaceStore.getState().workspace.openTabs.map((tab) => tab.filePath),
    ).toEqual(["/fixtures/a.json", "/fixtures/c.json", "/fixtures/b.json"]);
    expect(useWorkspaceStore.getState().workspace.activeTabIndex).toBe(2);
    expect(document.activeElement?.getAttribute("data-tab-id")).toBe("/fixtures/b.json");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
    expect(flushWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps the boundary tab selected and focused without persisting a no-op", async () => {
    const openTabs = [
      createTab("/fixtures/a.json", "A"),
      createTab("/fixtures/b.json", "B"),
    ];
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace("Test"),
        openTabs,
        activeTabIndex: 0,
      },
      filePath: "/fixtures/workspace.json",
      loaded: true,
    });
    flushWorkspace.mockClear();

    host = await mount(
      createElement(TabBar, {
        onMenuSelect: vi.fn(),
        onChromeHeightChange: vi.fn(),
      }),
    );
    const first = document.querySelector<HTMLElement>('[data-tab-id="/fixtures/a.json"]');
    if (!first) throw new Error("first tab not found");
    first.focus();

    await act(async () => {
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(
      useWorkspaceStore.getState().workspace.openTabs.map((tab) => tab.filePath),
    ).toEqual(["/fixtures/a.json", "/fixtures/b.json"]);
    expect(useWorkspaceStore.getState().workspace.activeTabIndex).toBe(0);
    expect(document.activeElement).toBe(first);
    expect(flushWorkspace).not.toHaveBeenCalled();
  });
});
