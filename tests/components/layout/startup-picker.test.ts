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
vi.mock("../../../src/repositories", () => ({
  openJsonFileDialog: vi.fn(),
  saveJsonFileDialog: vi.fn(),
  createPreferencesFile: vi.fn(),
  createWorkspaceFile: vi.fn(),
  loadPreferences: vi.fn(),
  loadWorkspace: vi.fn(),
  showMessage: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: (e: unknown) => ({ error: { message: String(e) } }),
}));

import { StartupPicker } from "../../../src/components/layout/StartupPicker";
import { useAppStateStore } from "../../../src/state/app-state-store";
import { createDefaultAppState } from "../../../src/models";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
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
});
