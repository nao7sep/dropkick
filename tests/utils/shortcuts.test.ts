import { describe, it, expect, afterEach, vi } from "vitest";
import {
  matchesShortcutKey,
  consumesSpace,
  tabCycleDirection,
  hasPrimaryShortcutModifier,
  hasPointerCommandModifier,
  isEditableTarget,
  isOpenSettingsShortcut,
  isOpenShortcutsHelpShortcut,
  noteEditorAction,
  isTaskDeletionShortcut,
} from "../../src/utils/shortcuts";
import { importWithPlatform } from "../helpers/platform";

type ShortcutsModule = typeof import("../../src/utils/shortcuts");

function tabEvent(opts: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key?: string;
}) {
  return {
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    key: opts.key ?? "Tab",
  };
}

describe("tabCycleDirection", () => {
  it("cycles forward on Ctrl+Tab and backward on Ctrl+Shift+Tab", () => {
    expect(tabCycleDirection(tabEvent({ ctrlKey: true }))).toBe(1);
    expect(tabCycleDirection(tabEvent({ ctrlKey: true, shiftKey: true }))).toBe(-1);
  });

  it("requires literal Ctrl — Cmd+Tab does not cycle (macOS reserves it)", () => {
    // The whole point of the literal-Ctrl rule: Cmd+Tab is the OS app switcher,
    // so it must not be treated as a tab-cycle even though Cmd is the primary
    // modifier on macOS.
    expect(tabCycleDirection(tabEvent({ metaKey: true }))).toBeNull();
    expect(tabCycleDirection(tabEvent({ ctrlKey: true, metaKey: true }))).toBeNull();
  });

  it("ignores Alt and non-Tab keys", () => {
    expect(tabCycleDirection(tabEvent({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(tabCycleDirection(tabEvent({ ctrlKey: true, key: "w" }))).toBeNull();
    expect(tabCycleDirection(tabEvent({ key: "Tab" }))).toBeNull();
  });
});

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

describe("hasPrimaryShortcutModifier", () => {
  it("fires on either Cmd or Ctrl — both are bound on every platform", () => {
    // The keyboard-shortcut-conventions' cross-machine muscle-memory rule:
    // the binding is platform-independent; only the display word is not.
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: true, altKey: false })).toBe(true);
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
  });

  it("rejects Alt chords — Windows AltGr arrives as Ctrl+Alt and must keep typing", () => {
    expect(hasPrimaryShortcutModifier({ metaKey: false, ctrlKey: true, altKey: true })).toBe(false);
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: false, altKey: true })).toBe(false);
    expect(hasPrimaryShortcutModifier({ metaKey: true, ctrlKey: true, altKey: true })).toBe(false);
  });
});

describe("hasPointerCommandModifier", () => {
  it("tests the command flags alone — Cmd+Alt+Click must keep working", () => {
    expect(hasPointerCommandModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(hasPointerCommandModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(hasPointerCommandModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });
});

// Build a fake editable-walk target chain.
function domNode(opts: {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string | null;
  parent?: ReturnType<typeof domNode> | null;
}): {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement: ReturnType<typeof domNode> | null;
  getAttribute: (name: string) => string | null;
} {
  return {
    tagName: opts.tagName,
    isContentEditable: opts.isContentEditable,
    parentElement: opts.parent ?? null,
    getAttribute: (name: string) => (name === "type" ? (opts.type ?? null) : null),
  };
}

describe("isEditableTarget", () => {
  it("recognizes textareas and text-bearing inputs", () => {
    expect(isEditableTarget(domNode({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "text" }))).toBe(true);
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: null }))).toBe(true); // default type is text
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "search" }))).toBe(true);
  });

  it("rejects non-text inputs and non-editable elements", () => {
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "checkbox" }))).toBe(false);
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "range" }))).toBe(false);
    expect(isEditableTarget(domNode({ tagName: "DIV" }))).toBe(false);
    expect(isEditableTarget(domNode({ tagName: "SELECT" }))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("walks parentElement — a rich-text target is a DIV inside the contenteditable", () => {
    const editorRoot = domNode({ tagName: "DIV", isContentEditable: true });
    const innerSpan = domNode({ tagName: "SPAN", parent: editorRoot });
    expect(isEditableTarget(innerSpan)).toBe(true);
  });
});

describe("shadowsMacTextBinding (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on macOS, flags every bare-Ctrl chord — the blanket rule, no key list", async () => {
    const { shadowsMacTextBinding } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    // Any Ctrl chord: inside a text field, Ctrl belongs to the macOS text
    // system whatever the key is (keyboard-shortcut-conventions).
    expect(shadowsMacTextBinding({ metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    // The Cmd half of the same chord is the binding and must fire.
    expect(shadowsMacTextBinding({ metaKey: true, ctrlKey: false, altKey: false })).toBe(false);
    expect(shadowsMacTextBinding({ metaKey: true, ctrlKey: true, altKey: false })).toBe(false);
    expect(shadowsMacTextBinding({ metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
  });

  it("never fires off macOS — there is no Cocoa keymap to shadow", async () => {
    const { shadowsMacTextBinding } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(shadowsMacTextBinding({ metaKey: false, ctrlKey: true, altKey: false })).toBe(false);
  });
});

describe("standsDownForMacText (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const textarea = { tagName: "TEXTAREA", isContentEditable: false, parentElement: null };
  const button = { tagName: "BUTTON", isContentEditable: false, parentElement: null };

  it("stands a Ctrl chord down inside a text field on macOS, and nowhere else", async () => {
    const { standsDownForMacText } = await importWithPlatform<ShortcutsModule>("mac", () => import("../../src/utils/shortcuts"));
    const ctrl = { metaKey: false, ctrlKey: true, altKey: false };
    const cmd = { metaKey: true, ctrlKey: false, altKey: false };

    // Inside a text field the Ctrl half belongs to the macOS text system.
    expect(standsDownForMacText(ctrl, textarea)).toBe(true);
    // Outside one it is a live alias.
    expect(standsDownForMacText(ctrl, button)).toBe(false);
    // The Cmd half is the binding and always fires, text field or not.
    expect(standsDownForMacText(cmd, textarea)).toBe(false);
  });

  it("never stands down off macOS", async () => {
    const { standsDownForMacText } = await importWithPlatform<ShortcutsModule>("windows", () => import("../../src/utils/shortcuts"));
    expect(
      standsDownForMacText({ metaKey: false, ctrlKey: true, altKey: false }, textarea),
    ).toBe(false);
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

describe("isOpenSettingsShortcut", () => {
  it("matches Cmd+comma and Ctrl+comma — both bound on every platform", () => {
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, key: "," }))).toBe(true);
    expect(isOpenSettingsShortcut(keyEvent({ ctrlKey: true, key: "," }))).toBe(true);
  });

  it("requires the modifier and rejects extra modifiers / other keys", () => {
    expect(isOpenSettingsShortcut(keyEvent({ key: "," }))).toBe(false); // bare comma
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "," }))).toBe(false);
    // AltGr (Ctrl+Alt) must keep typing — the shared predicate excludes Alt.
    expect(isOpenSettingsShortcut(keyEvent({ ctrlKey: true, altKey: true, key: "," }))).toBe(false);
    expect(isOpenSettingsShortcut(keyEvent({ metaKey: true, key: "." }))).toBe(false);
  });
});

describe("isOpenShortcutsHelpShortcut", () => {
  it("matches Cmd+slash and Ctrl+slash — both bound on every platform", () => {
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, key: "/" }))).toBe(true);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ ctrlKey: true, key: "/" }))).toBe(true);
  });

  it("matches a bare '?' regardless of platform (Shift produces it)", () => {
    expect(isOpenShortcutsHelpShortcut(keyEvent({ key: "?" }))).toBe(true);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ shiftKey: true, key: "?" }))).toBe(true);
  });

  it("matches Cmd+/ even when Shift is held (shifted-slash layouts, e.g. German QWERTZ)", () => {
    // On layouts where "/" is Shift+<key>, the chord arrives as key "/" with
    // shiftKey true; allowing it here keeps Cmd+/ working there.
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "/" }))).toBe(true);
  });

  it("rejects a primary-modified '?', a bare slash, and AltGr combos", () => {
    // Cmd+? is not a binding (the slash form is), so a modified "?" must miss.
    // On US layouts Cmd+Shift+/ reports key "?", not "/", so it lands here.
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, key: "?" }))).toBe(false);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ metaKey: true, shiftKey: true, key: "?" }))).toBe(false);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ key: "/" }))).toBe(false); // bare slash
    // AltGr producing "/" or "?" is typing, not the chord or the alias: the
    // slash branch loses its modifier via the predicate's Alt exclusion, and
    // the "?" branch's own raw !altKey flag rejects it.
    expect(isOpenShortcutsHelpShortcut(keyEvent({ ctrlKey: true, altKey: true, key: "/" }))).toBe(false);
    expect(isOpenShortcutsHelpShortcut(keyEvent({ ctrlKey: true, altKey: true, key: "?" }))).toBe(false);
  });
});

describe("isTaskDeletionShortcut", () => {
  const event = (overrides: Partial<Parameters<typeof isTaskDeletionShortcut>[0]>) => ({
    key: "Delete",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
  });

  it("accepts one plain Delete or Backspace keypress", () => {
    expect(isTaskDeletionShortcut(event({ key: "Delete" }))).toBe(true);
    expect(isTaskDeletionShortcut(event({ key: "Backspace" }))).toBe(true);
  });

  it("rejects every modified variant and auto-repeat", () => {
    expect(isTaskDeletionShortcut(event({ metaKey: true }))).toBe(false);
    expect(isTaskDeletionShortcut(event({ ctrlKey: true }))).toBe(false);
    expect(isTaskDeletionShortcut(event({ altKey: true }))).toBe(false);
    expect(isTaskDeletionShortcut(event({ shiftKey: true }))).toBe(false);
    expect(isTaskDeletionShortcut(event({ repeat: true }))).toBe(false);
  });

  it("rejects unrelated keys", () => {
    expect(isTaskDeletionShortcut(event({ key: "x" }))).toBe(false);
  });
});

describe("noteEditorAction", () => {
  function chord(opts: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  }) {
    return {
      key: opts.key,
      metaKey: opts.metaKey ?? false,
      ctrlKey: opts.ctrlKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      altKey: opts.altKey ?? false,
    };
  }

  // The defect this whole function exists to prevent: the note EDIT path read the
  // modifier and Enter but never Shift, so the documented "save as actionable"
  // chord saved the text and silently dropped the flag. Both halves are asserted —
  // a Shift branch that is never observed distinct from the plain one proves nothing.
  it("distinguishes plain save from save-as-actionable on Shift", () => {
    expect(noteEditorAction(chord({ key: "Enter", metaKey: true }))).toBe("save");
    expect(noteEditorAction(chord({ key: "Enter", metaKey: true, shiftKey: true }))).toBe(
      "save-actionable",
    );
  });

  it("maps Escape to cancel, with or without Shift", () => {
    expect(noteEditorAction(chord({ key: "Escape" }))).toBe("cancel");
    expect(noteEditorAction(chord({ key: "Escape", shiftKey: true }))).toBe("cancel");
  });

  it("claims nothing for keys the textarea should keep", () => {
    expect(noteEditorAction(chord({ key: "Enter" }))).toBeNull();
    expect(noteEditorAction(chord({ key: "a", metaKey: true }))).toBeNull();
    expect(noteEditorAction(chord({ key: "Tab" }))).toBeNull();
  });
});

describe("noteEditorAction — platform text bindings", () => {
  // On macOS Ctrl+Enter is Cocoa's insertLineBreak: inside a text field, so the
  // editor must yield it rather than saving. Off Apple platforms Ctrl IS the
  // primary modifier and the same chord must save — the two assertions together
  // are what make this a platform rule rather than a blanket exclusion.
  it("yields Ctrl+Enter on macOS but honours it elsewhere", async () => {
    const mac = await importWithPlatform<ShortcutsModule>("mac", () =>
      import("../../src/utils/shortcuts"),
    );
    expect(
      mac.noteEditorAction({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();

    const win = await importWithPlatform<ShortcutsModule>("windows", () =>
      import("../../src/utils/shortcuts"),
    );
    expect(
      win.noteEditorAction({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe("save");
    expect(
      win.noteEditorAction({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBe("save-actionable");
  });
});
