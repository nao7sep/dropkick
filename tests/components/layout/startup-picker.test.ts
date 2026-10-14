// @vitest-environment happy-dom
//
// The workspace list: a real listbox of workspace files, each shown by the
// name stored in it, with New, Add existing, Rename and Remove. It was once a
// stack of clickable divs, so a keyboard-only user could reach the buttons but
// never change which workspace was selected.

import { inEnglish } from "../../helpers/i18n";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const repositories = vi.hoisted(() => ({
  openJsonFileDialog: vi.fn(),
  saveJsonFileDialog: vi.fn(),
  showMessage: vi.fn(),
  flushAppConfig: vi.fn(async () => {}),
  renameWorkspaceFile: vi.fn(),
  loadWorkspace: vi.fn(),
}));
const NAMES: Record<string, string> = { "/a/ws.json": "Alpha", "/b/ws.json": "Beta" };
function loaded(path: string) {
  return { status: "success", workspace: { id: path, name: NAMES[path], openTabs: [], recentFiles: [], activeTabIndex: -1 } };
}
vi.mock("../../../src/repositories", () => ({
  openJsonFileDialog: repositories.openJsonFileDialog,
  saveJsonFileDialog: repositories.saveJsonFileDialog,
  createWorkspaceFile: vi.fn(),
  loadWorkspace: repositories.loadWorkspace,
  renameWorkspaceFile: repositories.renameWorkspaceFile,
  flushAppConfig: repositories.flushAppConfig,
  showMessage: repositories.showMessage,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: (e: unknown) => ({ error: { message: String(e) } }),
}));

import { StartupPicker } from "../../../src/components/layout/StartupPicker";
import { useAppConfigStore } from "../../../src/state/app-config-store";
import { useAppStateStore } from "../../../src/state/app-state-store";
import { useWorkspaceStore } from "../../../src/state/workspace-store";
import { createDefaultAppState } from "../../../src/models";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
  vi.clearAllMocks();
});

async function mountWithKnownFiles(onLaunch: (workspace: string) => void = () => {}) {
  repositories.loadWorkspace.mockImplementation(async (path: string) =>
    NAMES[path] ? loaded(path) : { status: "missing" });
  useAppStateStore.setState({
    appState: {
      ...createDefaultAppState(),
      lastWorkspacePath: "/a/ws.json",
    },
    filePath: "/home/state.json",
    loaded: true,
  });
  useAppConfigStore.setState({
    appConfig: { knownWorkspaces: ["/a/ws.json", "/b/ws.json"] },
    filePath: "/home/config.json", loaded: true,
  });
  host = await mount(createElement(StartupPicker, { onLaunch }));
}

function workspaceListbox(): HTMLElement {
  const list = document.querySelector('[role="listbox"][aria-label="Workspaces"]');
  if (!list) throw new Error("preferences listbox not found");
  return list as HTMLElement;
}

function selectedOptionText(): string | undefined {
  return document
    .querySelector('[aria-label="Workspaces"] [aria-selected="true"]')
    ?.textContent?.trim();
}

async function pressOn(el: HTMLElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("StartupPicker — the file lists are real listboxes", () => {
  it("exposes one tab stop with option semantics", async () => {
    await mountWithKnownFiles();
    const list = workspaceListbox();
    expect(list.getAttribute("tabindex")).toBe("0");
    const options = list.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(list.getAttribute("aria-activedescendant")).toBeTruthy();
  });

  it("moves the selection with the arrow keys", async () => {
    await mountWithKnownFiles();
    expect(selectedOptionText()).toContain("/a/ws.json");

    await pressOn(workspaceListbox(), "ArrowDown");
    expect(selectedOptionText()).toContain("/b/ws.json");

    await pressOn(workspaceListbox(), "ArrowUp");
    expect(selectedOptionText()).toContain("/a/ws.json");
  });

  it("keeps the keyboard target when an earlier option is hovered", async () => {
    await mountWithKnownFiles();
    await pressOn(workspaceListbox(), "ArrowDown");
    const first = workspaceListbox().querySelector<HTMLElement>('[role="option"]')!;
    await act(async () => {
      first.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true }));
      first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(selectedOptionText()).toContain("/b/ws.json");
    await pressOn(workspaceListbox(), "ArrowUp");
    expect(selectedOptionText()).toContain("/a/ws.json");
  });

  it("jumps to the ends with Home and End", async () => {
    await mountWithKnownFiles();
    await pressOn(workspaceListbox(), "End");
    expect(selectedOptionText()).toContain("/b/ws.json");
    await pressOn(workspaceListbox(), "Home");
    expect(selectedOptionText()).toContain("/a/ws.json");
  });

  it("moves by a page with PageUp and PageDown", async () => {
    await mountWithKnownFiles();
    await pressOn(workspaceListbox(), "PageDown");
    expect(selectedOptionText()).toContain("/b/ws.json");
    await pressOn(workspaceListbox(), "PageUp");
    expect(selectedOptionText()).toContain("/a/ws.json");
  });

  it("does not wrap past the ends", async () => {
    await mountWithKnownFiles();
    await pressOn(workspaceListbox(), "ArrowUp");
    expect(selectedOptionText()).toContain("/a/ws.json");
    await pressOn(workspaceListbox(), "End");
    await pressOn(workspaceListbox(), "ArrowDown");
    expect(selectedOptionText()).toContain("/b/ws.json");
  });

  it("scrolls an arrow-selected option into view", async () => {
    await mountWithKnownFiles();
    const second = workspaceListbox().querySelectorAll<HTMLElement>(
      '[role="option"]',
    )[1];
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;

    await pressOn(workspaceListbox(), "ArrowDown");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});

describe("StartupPicker — native picker failures", () => {
  it("retains authored copy when the Open picker rejects", async () => {
    await mountWithKnownFiles();
    repositories.openJsonFileDialog.mockRejectedValueOnce(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL IPC wrapper"),
    );

    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add existing",
    );
    expect(open).toBeTruthy();
    await act(async () => open!.click());

    expect(repositories.showMessage.mock.calls.map((args: unknown[]) => args.map((m) => inEnglish(m as never)))).toEqual([
      [
        "Open Workspace Failed",
        "Opening the workspace file could not be completed. Check that the selected location is available and try again.",
      ],
    ]);
    expect(JSON.stringify(repositories.showMessage.mock.calls)).not.toMatch(
      /EACCES|HOSTILE-SENTINEL|TypeError|IPC|private\/tmp/,
    );
  });

  it("retains authored copy when the Save picker rejects", async () => {
    await mountWithKnownFiles();
    repositories.saveJsonFileDialog.mockRejectedValueOnce(
      new Error("EACCES /private/tmp/HOSTILE-SENTINEL"),
    );

    const create = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New",
    );
    expect(create).toBeTruthy();
    await act(async () => create!.click());

    expect(repositories.showMessage.mock.calls.map((args: unknown[]) => args.map((m) => inEnglish(m as never)))).toEqual([
      [
        "Create Workspace Failed",
        "Creating the workspace file could not be completed. Check that the selected location is available and try again.",
      ],
    ]);
    expect(JSON.stringify(repositories.showMessage.mock.calls)).not.toMatch(
      /EACCES|HOSTILE-SENTINEL|private\/tmp/,
    );
  });
});

// Built on the same shell every dialog uses — one shared background, the
// header/body/footer bands and their band-edge separators — with no close
// control at startup (there is nothing to close back to), and a primary
// action that reads "Open workspace" rather than "Launch".
describe("StartupPicker — the shared dialog shell", () => {
  it("gives the header and footer their own band lines, and no others", async () => {
    await mountWithKnownFiles();
    const header = document.querySelector("h2")!.parentElement!;
    const card = header.parentElement!;
    const footer = card.lastElementChild as HTMLElement;
    expect(header.className).toContain("border-b");
    expect(header.className).toContain("border-border");
    expect(footer.className).toContain("border-t");
    expect(footer.className).toContain("border-border");
  });

  it("carries the title as the header band's own content, with no close control", async () => {
    await mountWithKnownFiles();
    const heading = document.querySelector("h2")!;
    expect(heading.textContent).toBe("Workspaces");
    // Nothing in the header closes back to a screen behind it.
    const header = heading.parentElement!;
    expect(header.querySelectorAll("button")).toHaveLength(0);
  });

  it("labels the footer's primary action Open, not Launch", async () => {
    await mountWithKnownFiles();
    const buttons = Array.from(document.querySelectorAll("button"));
    // The footer's Open button is the one with the primary appearance —
    // every other "Open" on screen is a section's own file picker.
    const primaryOpen = buttons.find((button) => button.className.includes("dk-btn-primary"));
    expect(primaryOpen?.textContent?.trim()).toBe("Open workspace");
    expect(document.body.textContent).not.toContain("Launch");
  });
});

describe("StartupPicker — keyboard behaviour", () => {
  it("starts on the list when workspaces are listed, so arrows choose and Enter opens", async () => {
    await mountWithKnownFiles();
    expect(document.activeElement).toBe(workspaceListbox());
  });

  it("preselects no button when nothing is listed: New is not a default action", async () => {
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: [] }, filePath: "/home/config.json", loaded: true });
    useAppStateStore.setState({ appState: createDefaultAppState(), filePath: "/home/state.json", loaded: true });
    host = await mount(createElement(StartupPicker, { onLaunch: () => {} }));
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });

  it("puts New and Add existing above the list and the row actions under it, disabled without a selection", async () => {
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: [] }, filePath: "/home/config.json", loaded: true });
    useAppStateStore.setState({ appState: createDefaultAppState(), filePath: "/home/state.json", loaded: true });
    host = await mount(createElement(StartupPicker, { onLaunch: () => {} }));
    const list = workspaceListbox();
    const before = (b: HTMLElement) => Boolean(b.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(button("New"))).toBe(true);
    expect(before(button("Add existing"))).toBe(true);
    expect(before(button("Rename"))).toBe(false);
    expect(before(button("Remove"))).toBe(false);
    expect(button("Rename").disabled).toBe(true);
    expect(button("Remove").disabled).toBe(true);
  });

  it("does nothing harmful on Escape — there is no close path to trigger", async () => {
    const onLaunch = vi.fn();
    await mountWithKnownFiles(onLaunch);
    await act(async () => {
      // cancelable: true — a real Escape keypress is, and Radix's dismiss
      // layer only honours preventDefault() on a cancelable event.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(onLaunch).not.toHaveBeenCalled();
    // The screen is still up — Escape did not tear anything down.
    expect(document.querySelector("h2")?.textContent).toBe("Workspaces");
  });
});

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

describe("StartupPicker — the workspace list", () => {
  it("shows each workspace by the name stored in it, with its path, or by file name when unreadable", async () => {
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: [] }, filePath: "/home/config.json", loaded: true });
    await mountWithKnownFiles();
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: ["/a/ws.json", "/c/gone.json"] } });
    await act(async () => {});
    const options = Array.from(workspaceListbox().querySelectorAll('[role="option"]'));
    expect(options.map((o) => o.textContent)).toEqual(["Alpha/a/ws.json", "gone/c/gone.json"]);
  });

  it("keeps long paths to one line and shows the selected workspace's whole path", async () => {
    const deep = "/Users/me/Documents/Clients and Projects/Long Term Planning 2026/Research and Development/Workspaces/ws.json";
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: [] }, filePath: "/home/config.json", loaded: true });
    await mountWithKnownFiles();
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: [deep] } });
    await act(async () => {});
    const option = workspaceListbox().querySelector('[role="option"]')!;
    expect(option.textContent).toContain("/Users/…/");
    expect(option.textContent).not.toContain("Research and Development/Workspaces/ws.json/");
    await act(async () => (option as HTMLElement).click());
    expect([...document.querySelectorAll("p")].some((p) => p.textContent === deep)).toBe(true);
  });

  it("opens the selected workspace with Enter on the list or a double-click", async () => {
    const onLaunch = vi.fn();
    await mountWithKnownFiles(onLaunch);
    await pressOn(workspaceListbox(), "Enter");
    expect(onLaunch).toHaveBeenLastCalledWith("/a/ws.json");
    const second = workspaceListbox().querySelectorAll<HTMLElement>('[role="option"]')[1];
    await act(async () => second.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onLaunch).toHaveBeenLastCalledWith("/b/ws.json");
  });

  it("renames a workspace that is not open in its own file", async () => {
    await mountWithKnownFiles();
    repositories.renameWorkspaceFile.mockResolvedValue(loaded("/a/ws.json"));
    await act(async () => button("Rename").click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]')!;
    expect(input.value).toBe("Alpha");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, "  Home   tasks ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressOn(input, "Enter");
    expect(repositories.renameWorkspaceFile).toHaveBeenCalledExactlyOnceWith("/a/ws.json", "Home tasks");
    expect(selectedOptionText()).toBe("Home tasks/a/ws.json");
  });

  it("renames the open workspace through its store", async () => {
    const renameWorkspace = vi.fn(async () => true);
    useWorkspaceStore.setState({ filePath: "/a/ws.json", loaded: true, renameWorkspace });
    try {
      await mountWithKnownFiles();
      await act(async () => button("Rename").click());
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]')!;
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setValue.call(input, "Work");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await pressOn(input, "Enter");
      expect(renameWorkspace).toHaveBeenCalledExactlyOnceWith("Work");
      expect(repositories.renameWorkspaceFile).not.toHaveBeenCalled();
    } finally {
      useWorkspaceStore.setState({ filePath: "", loaded: false });
    }
  });

  it("cancels only the rename on Escape", async () => {
    const onCancel = vi.fn();
    useAppStateStore.setState({ appState: { ...createDefaultAppState(), lastWorkspacePath: "/a/ws.json" }, filePath: "/home/state.json", loaded: true });
    useAppConfigStore.setState({ appConfig: { knownWorkspaces: ["/a/ws.json"] }, filePath: "/home/config.json", loaded: true });
    repositories.loadWorkspace.mockImplementation(async (path: string) => loaded(path));
    host = await mount(createElement(StartupPicker, { onLaunch: () => {}, onCancel }));
    await act(async () => button("Rename").click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('input[aria-label="Workspace name"]')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(repositories.renameWorkspaceFile).not.toHaveBeenCalled();
    expect(document.querySelector("h2")?.textContent).toBe("Workspaces");
  });

  it("removes a workspace from the list without touching its file", async () => {
    await mountWithKnownFiles();
    await act(async () => button("Remove").click());
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/b/ws.json"]);
    expect(repositories.renameWorkspaceFile).not.toHaveBeenCalled();
    expect(selectedOptionText()).toBe("Beta/b/ws.json");
  });
});
