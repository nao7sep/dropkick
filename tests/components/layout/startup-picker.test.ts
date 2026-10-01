// @vitest-environment happy-dom
//
// The launch gate's two file lists drive its only decision. They were a stack
// of clickable divs, so a keyboard-only user could tab to Open / New / Remove /
// Launch but never change which file was selected — switching to a second
// workspace meant re-picking the same file through the native dialog.

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
import { useAppConfigStore } from "../../../src/state/app-config-store";
import { useAppStateStore } from "../../../src/state/app-state-store";
import { createDefaultAppState } from "../../../src/models";

let host: Mounted;

afterEach(async () => {
  await host?.unmount();
  vi.clearAllMocks();
});

async function mountWithKnownFiles(onLaunch: (prefs: string, workspace: string) => void = () => {}) {
  useAppStateStore.setState({
    appState: {
      ...createDefaultAppState(),
      lastPreferencesPath: "/a/prefs.json",
      lastWorkspacePath: "/a/ws.json",
    },
    filePath: "/home/state.json",
    loaded: true,
  });
  useAppConfigStore.setState({
    appConfig: { knownPreferences: ["/a/prefs.json", "/b/prefs.json"], knownWorkspaces: ["/a/ws.json"] },
    filePath: "/home/config.json", loaded: true,
  });
  host = await mount(createElement(StartupPicker, { onLaunch }));
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

  it("moves by a page with PageUp and PageDown", async () => {
    await mountWithKnownFiles();
    await pressOn(preferencesListbox(), "PageDown");
    expect(selectedOptionText()).toContain("/b/prefs.json");
    await pressOn(preferencesListbox(), "PageUp");
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

    expect(repositories.showMessage.mock.calls.map((args: unknown[]) => args.map((m) => inEnglish(m as never)))).toEqual([
      [
        "Open Preferences Failed",
        "Opening the preferences file could not be completed. Check that the selected location is available and try again.",
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
        "Create Preferences Failed",
        "Creating the preferences file could not be completed. Check that the selected location is available and try again.",
      ],
    ]);
    expect(JSON.stringify(repositories.showMessage.mock.calls)).not.toMatch(
      /EACCES|HOSTILE-SENTINEL|private\/tmp/,
    );
  });
});

// Built on the same shell every dialog uses — one shared background, the
// header/body/footer bands and their control-edge separators — with two
// deliberate differences: no close control (there is nothing to close back
// to at startup) and the footer's primary action reads "Open", the app's own
// existing term, rather than "Launch" (wrong once the app is already
// running).
describe("StartupPicker — the shared dialog shell", () => {
  it("gives the header and footer their own band lines, and no others", async () => {
    await mountWithKnownFiles();
    const header = document.querySelector("h2")!.parentElement!;
    const card = header.parentElement!;
    const footer = card.lastElementChild as HTMLElement;
    expect(header.className).toContain("border-b");
    expect(header.className).toContain("border-control-edge");
    expect(footer.className).toContain("border-t");
    expect(footer.className).toContain("border-control-edge");
  });

  it("carries the title as the header band's own content, with no close control", async () => {
    await mountWithKnownFiles();
    const heading = document.querySelector("h2")!;
    expect(heading.textContent).toBe("Dropkick");
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
    expect(primaryOpen?.textContent?.trim()).toBe("Open");
    expect(document.body.textContent).not.toContain("Launch");
  });
});

describe("StartupPicker — keyboard behaviour", () => {
  it("focuses the primary Open action once both files are selected, so Enter opens the selection", async () => {
    await mountWithKnownFiles();
    const buttons = Array.from(document.querySelectorAll("button"));
    const primaryOpen = buttons.find((button) => button.className.includes("dk-btn-primary"));
    // A real <button>, so the browser's own Enter-activates-the-focused-button
    // behaviour opens the selection; nothing here needs to reimplement that.
    expect(document.activeElement).toBe(primaryOpen);
    expect(primaryOpen?.disabled).toBe(false);
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
    expect(document.querySelector("h2")?.textContent).toBe("Dropkick");
  });
});
