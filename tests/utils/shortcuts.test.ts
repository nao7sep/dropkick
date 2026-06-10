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

// Build a full key+modifier event; unspecified modifiers default to false.
function keyEvent(opts: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key: string;
}) {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...opts,
  };
}

describe("isOpenSettingsShortcut (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the primary modifier + comma on macOS (Cmd)", async () => {
    const { isOpenSettingsShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, key: "," }))).toBe(true);
    // On macOS the primary modifier is Cmd, so Ctrl+comma must not match.
    expect(isOpenSettingsShortcut(keyEvent({ ctrlKey: true, key: "," }))).toBe(false);
  });

  it("matches the primary modifier + comma on Windows (Ctrl)", async () => {
    const { isOpenSettingsShortcut } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(isOpenSettingsShortcut(keyEvent({ ctrlKey: true, key: "," }))).toBe(true);
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, key: "," }))).toBe(false);
  });

  it("requires the modifier and rejects extra modifiers / other keys", async () => {
    const { isOpenSettingsShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(isOpenSettingsShortcut(keyEvent({ key: "," }))).toBe(false); // bare comma
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "," }))).toBe(false);
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, altKey: true, key: "," }))).toBe(false);
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, key: "." }))).toBe(false);
  });
});

describe("isOpenShortcutsHelpShortcut (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches the primary modifier + slash on macOS (Cmd)", async () => {
    const { isOpenShortcutsHelpShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, key: "/" }))).toBe(true);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ ctrlKey: true, key: "/" }))).toBe(false);
  });

  it("matches the primary modifier + slash on Windows (Ctrl)", async () => {
    const { isOpenShortcutsHelpShortcut } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(isOpenShortcutsHelpShortcut(keyEvent({ ctrlKey: true, key: "/" }))).toBe(true);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, key: "/" }))).toBe(false);
  });

  it("matches a bare '?' regardless of platform (Shift produces it)", async () => {
    const { isOpenShortcutsHelpShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(isOpenShortcutsHelpShortcut(keyEvent({ key: "?" }))).toBe(true);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ shiftKey: true, key: "?" }))).toBe(true);
  });

  it("matches Cmd+/ even when Shift is held (shifted-slash layouts, e.g. German QWERTZ)", async () => {
    // On layouts where "/" is Shift+<key>, the chord arrives as key "/" with
    // shiftKey true; allowing it here keeps Cmd+/ working there.
    const { isOpenShortcutsHelpShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "/" }))).toBe(true);
  });

  it("rejects a primary-modified '?' and a bare slash", async () => {
    const { isOpenShortcutsHelpShortcut } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    // Cmd+? is not a binding (the slash form is), so a modified "?" must miss.
    // On US layouts Cmd+Shift+/ reports key "?", not "/", so it lands here.
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, key: "?" }))).toBe(false);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "?" }))).toBe(false);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ key: "/" }))).toBe(false); // bare slash
    // Alt/AltGr is still excluded on the slash branch.
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, altKey: true, key: "/" }))).toBe(false);
  });
});
