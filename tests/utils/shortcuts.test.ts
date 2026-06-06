import { describe, it, expect, afterEach, vi } from "vitest";
import { matchesShortcutKey, consumesSpace } from "../../src/utils/shortcuts";
import { importWithPlatform } from "../helpers/platform";

type ShortcutsModule = typeof import("../../src/utils/shortcuts");

// Build a fake event target. `role` becomes what getAttribute("role") returns.
function target(opts: {
  tagName?: string;
  isContentEditable?: boolean;
  role?: string | null;
}) {
  return {
    tagName: opts.tagName,
    isContentEditable: opts.isContentEditable,
    getAttribute: (name: string) =>
      name === "role" ? (opts.role ?? null) : null,
  };
}

describe("consumesSpace", () => {
  it("is false for a null target (Space is free to act)", () => {
    expect(consumesSpace(null)).toBe(false);
    expect(consumesSpace(undefined)).toBe(false);
  });

  it("is false for non-interactive elements", () => {
    expect(consumesSpace(target({ tagName: "DIV" }))).toBe(false);
    expect(consumesSpace(target({ tagName: "SPAN" }))).toBe(false);
    expect(consumesSpace(target({ tagName: "BODY" }))).toBe(false);
  });

  it("is true for native space-consuming controls", () => {
    for (const tagName of ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"]) {
      expect(consumesSpace(target({ tagName }))).toBe(true);
    }
  });

  it("is true for contenteditable elements", () => {
    expect(consumesSpace(target({ tagName: "DIV", isContentEditable: true }))).toBe(
      true,
    );
  });

  it("is true for elements with a space-consuming ARIA role", () => {
    for (const role of ["button", "checkbox", "switch", "menuitem", "tab", "option"]) {
      expect(consumesSpace(target({ tagName: "DIV", role }))).toBe(true);
    }
  });

  it("is false for a non-consuming role", () => {
    expect(consumesSpace(target({ tagName: "DIV", role: "presentation" }))).toBe(
      false,
    );
  });
});

describe("matchesShortcutKey", () => {
  it("matches single-character keys case-insensitively", () => {
    expect(matchesShortcutKey({ key: "P" }, "p")).toBe(true);
    expect(matchesShortcutKey({ key: "p" }, "P")).toBe(true);
  });

  it("matches multi-character keys exactly (case-sensitive)", () => {
    expect(matchesShortcutKey({ key: "Enter" }, "Enter")).toBe(true);
    expect(matchesShortcutKey({ key: "enter" }, "Enter")).toBe(false);
  });

  it("does not match different keys", () => {
    expect(matchesShortcutKey({ key: "x" }, "c")).toBe(false);
  });
});

describe("hasPrimaryShortcutModifier (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses metaKey (Cmd) on macOS", async () => {
    const { hasPrimaryShortcutModifier } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true })).toBe(false);
  });

  it("uses ctrlKey on Windows", async () => {
    const { hasPrimaryShortcutModifier } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe("primaryModifierLabel (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is 'Cmd' on macOS", async () => {
    const { primaryModifierLabel } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(primaryModifierLabel).toBe("Cmd");
  });

  it("is 'Ctrl' on Windows", async () => {
    const { primaryModifierLabel } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(primaryModifierLabel).toBe("Ctrl");
  });
});
