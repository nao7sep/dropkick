// @vitest-environment happy-dom
//
// The launch gate's two file lists drive its only decision. They were a stack
// of clickable divs, so a keyboard-only user could tab to Open / New / Remove /
// Launch but never change which file was selected — switching to a second
// workspace meant re-picking the same file through the native dialog.

import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { mount } from "../../helpers/react-dom";
import type { Mounted } from "../../helpers/react-dom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const repositories = vi.hoisted(() => ({
  openJsonFileDialog: vi.fn(),
  saveJsonFileDialog: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../../../src/repositories", () => ({
  openJsonFileDialog: repositories.openJsonFileDialog,
  saveJsonFileDialog: repositories.saveJsonFileDialog,
  createPreferencesFile: vi.fn(),
  createWorkspaceFile: vi.fn(),
  loadPreferences: vi.fn(),
  loadWorkspace: vi.fn(),
  showMessage: repositories.showMessage,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: (e: unknown) => ({ error: { message: String(e) } }),
}));

import { StartupPicker } from "../../../src/components/layout/StartupPicker";
import { useAppStateStore } from "../../../src/state/app-state-store";
import { createDefaultAppState } from "../../../src/models";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
  vi.clearAllMocks();
});

async function mountWithKnownFiles() {
  useAppStateStore.setState({
    appState: {
      ...createDefaultAppState(),
      knownPreferences: ["/a/prefs.json", "/b/prefs.json"],
      knownWorkspaces: ["/a/ws.json"],
      lastPreferencesPath: "/a/prefs.json",
      lastWorkspacePath: "/a/ws.json",
    },
    filePath: "/home/state.json",
    loaded: true,
  });
  host = await mount(createElement(StartupPicker, { onLaunch: () => {} }));
}

function preferencesListbox(): HTMLElement {
  const list = document.querySelector('[role="listbox"][aria-label="Preferences"]');
  if (!list) throw new Error("preferences listbox not found");
  return list as HTMLElement;
}

function selectedOptionText(): string | undefined {
  return document
    .querySelector('[aria-label="Preferences"] [aria-selected="true"]')
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
    const list = preferencesListbox();
    expect(list.getAttribute("tabindex")).toBe("0");
    const options = list.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(list.getAttribute("aria-activedescendant")).toBeTruthy();
  });

  it("moves the selection with the arrow keys", async () => {
    await mountWithKnownFiles();
    expect(selectedOptionText()).toContain("/a/prefs.json");

    await pressOn(preferencesListbox(), "ArrowDown");
    expect(selectedOptionText()).toContain("/b/prefs.json");

    await pressOn(preferencesListbox(), "ArrowUp");
    expect(selectedOptionText()).toContain("/a/prefs.json");
  });

  it("jumps to the ends with Home and End", async () => {
    await mountWithKnownFiles();
    await pressOn(preferencesListbox(), "End");
    expect(selectedOptionText()).toContain("/b/prefs.json");
    await pressOn(preferencesListbox(), "Home");
    expect(selectedOptionText()).toContain("/a/prefs.json");
  });

  it("does not wrap past the ends", async () => {
    await mountWithKnownFiles();
    await pressOn(preferencesListbox(), "ArrowUp");
    expect(selectedOptionText()).toContain("/a/prefs.json");
    await pressOn(preferencesListbox(), "End");
    await pressOn(preferencesListbox(), "ArrowDown");
    expect(selectedOptionText()).toContain("/b/prefs.json");
  });

  it("scrolls an arrow-selected option into view", async () => {
    await mountWithKnownFiles();
    const second = preferencesListbox().querySelectorAll<HTMLElement>(
      '[role="option"]',
    )[1];
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;

    await pressOn(preferencesListbox(), "ArrowDown");

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
      (button) => button.textContent?.trim() === "Open",
    );
    expect(open).toBeTruthy();
    await act(async () => open!.click());

    expect(repositories.showMessage).toHaveBeenCalledWith(
      "Open Preferences Failed",
      "Opening the preferences file could not be completed. Check that the selected location is available and try again.",
    );
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

    expect(repositories.showMessage).toHaveBeenCalledWith(
      "Create Preferences Failed",
      "Creating the preferences file could not be completed. Check that the selected location is available and try again.",
    );
    expect(JSON.stringify(repositories.showMessage.mock.calls)).not.toMatch(
      /EACCES|HOSTILE-SENTINEL|private\/tmp/,
    );
  });
});
