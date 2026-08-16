interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

// Pointer chords carry no altKey semantics (AltGr types characters, which has
// no meaning for a click), so their predicate takes only the two command flags.
interface PointerModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
}

interface ShortcutKeyState {
  key: string;
}

// Full key+modifier shape for the utility-dialog shortcut predicates below,
// composed from the minimal shapes above. KeyboardEvent satisfies it structurally.
interface UtilityShortcutEvent extends ShortcutModifierState, ShortcutKeyState {
  altKey: boolean;
  shiftKey: boolean;
}

// Minimal shape of an event target, so consumesSpace stays DOM-free and unit
// testable. HTMLElement satisfies it structurally.
interface SpaceTargetState {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

// Tags and ARIA roles whose own Space behavior must be preserved: typing a
// space, or activating a focused button/link/checkbox.
const SPACE_CONSUMING_TAGS = new Set([
  "BUTTON",
  "A",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);
const SPACE_CONSUMING_ROLES = new Set([
  "button",
  "checkbox",
  "switch",
  "menuitem",
  "tab",
  "option",
]);

const platformString =
  typeof navigator === "undefined"
    ? ""
    : navigator.platform || navigator.userAgent;

const isApplePlatform = /Mac|iPhone|iPad|iPod/.test(platformString);

// Display label for the primary modifier key, for use in shortcut hints. Only
// the DISPLAY word is platform-bound; the predicate below accepts both.
export const primaryModifierLabel = isApplePlatform ? "Cmd" : "Ctrl";

// The one shared command-modifier predicate (keyboard-shortcut-conventions):
// both Cmd and Ctrl fire on every platform, and Alt is excluded because
// Chromium delivers Windows AltGr as Ctrl+Alt — an unguarded predicate would
// let an AltGr-typed character fire an accelerator and swallow the character.
export function hasPrimaryShortcutModifier(
  event: ShortcutModifierState,
): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

// The pointer-chord half: Cmd/Ctrl+Click toggle-select and friends test the
// command flags alone — no Alt exclusion, so Cmd+Alt+Click keeps working.
export function hasPointerCommandModifier(event: PointerModifierState): boolean {
  return event.metaKey || event.ctrlKey;
}

// Bare-Ctrl chords on these letters shadow Cocoa's text-editing keymap
// (StandardKeyBinding.dict: kill-line, transpose, next-line, ...), as does
// Ctrl+Slash. Such a chord stands down while the target is editable on macOS —
// the Cmd half is unbound there and always fires (keyboard-shortcut-conventions).
const COCOA_CTRL_TEXT_KEYS = new Set([
  "a", "b", "d", "e", "f", "h", "k", "l", "n", "o", "p", "t", "v", "y", "/",
]);

export function shadowsMacTextBinding(
  event: ShortcutModifierState & ShortcutKeyState,
): boolean {
  if (!isApplePlatform) return false;
  if (event.metaKey || !event.ctrlKey) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return COCOA_CTRL_TEXT_KEYS.has(key);
}

// Structural shape of an editable-target check, DOM-free for unit tests.
interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement?: EditableTargetLike | null;
  getAttribute?: (name: string) => string | null;
}

// INPUT types that carry typed text; the rest (checkbox, radio, range, ...)
// consume no printable key and are not editable for chord purposes.
const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "number", "date",
  "datetime-local", "month", "time", "week",
]);

// One editable-target predicate for the whole app. The parentElement walk is
// load-bearing: a rich-text editor's event target is a DIV descendant of the
// contenteditable, so a tagName-only test would let every chord through.
export function isEditableTarget(
  target: EditableTargetLike | null | undefined,
): boolean {
  let current: EditableTargetLike | null | undefined = target;
  while (current) {
    if (current.isContentEditable) return true;
    if (current.tagName === "TEXTAREA") return true;
    if (current.tagName === "INPUT") {
      const type = current.getAttribute?.("type")?.toLowerCase() ?? "text";
      return TEXT_INPUT_TYPES.has(type);
    }
    current = current.parentElement ?? null;
  }
  return false;
}

// Some webview/platform combinations report printable keys in lowercase even when
// Shift is held with a command-style shortcut. Normalize letter keys so shortcut
// matching does not depend on uppercase/lowercase event.key behavior.
export function matchesShortcutKey(
  event: ShortcutKeyState,
  expectedKey: string,
): boolean {
  const eventKey =
    event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const expected =
    expectedKey.length === 1 ? expectedKey.toLowerCase() : expectedKey;

  return eventKey === expected;
}

// Cmd/Ctrl+, opens Settings — the platform-conventional settings shortcut.
// The predicate already excludes Alt, so no per-chord altKey check remains.
export function isOpenSettingsShortcut(event: UtilityShortcutEvent): boolean {
  return (
    hasPrimaryShortcutModifier(event) &&
    !event.shiftKey &&
    event.key === ","
  );
}

// Cmd/Ctrl+/ or a bare "?" opens the keyboard-shortcuts help. "?" is a
// printable character, so callers must ignore it while the user is typing; the
// Cmd/Ctrl+/ form carries a modifier and may fire anywhere, like Cmd+N.
//
// Shift is intentionally NOT excluded on the "/" branch: on layouts where "/"
// is a shifted glyph (e.g. German QWERTZ Shift+7), the chord arrives as
// key === "/" with shiftKey === true. On US-style layouts Shift+"/" instead
// produces key === "?", which never reaches this branch, so allowing Shift here
// only rescues the shifted-slash layouts and cannot cause a false match.
export function isOpenShortcutsHelpShortcut(
  event: UtilityShortcutEvent,
): boolean {
  if (hasPrimaryShortcutModifier(event) && event.key === "/") {
    return true;
  }
  // Bare printable "?" alias: raw flags, never !predicate(e) — the predicate's
  // Alt exclusion would make "no command modifier" read true under AltGr.
  return (
    !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "?"
  );
}

// Ctrl+Tab cycles to the next tab and Ctrl+Shift+Tab to the previous — a
// LITERAL Ctrl on every platform, macOS included. The tab-cycle deliberately
// does NOT use the platform primary modifier: on macOS Cmd+Tab is reserved by
// the OS for app switching (so it would never reach the app), while Ctrl+Tab is
// free there and is the cross-platform browser convention. Returns the cycle
// direction (+1 next, -1 previous), or null when the event isn't a tab-cycle
// chord.
export function tabCycleDirection(event: UtilityShortcutEvent): 1 | -1 | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.key !== "Tab") {
    return null;
  }
  return event.shiftKey ? -1 : 1;
}

// True when the focused element should keep Space for itself. Everywhere else
// Space is free to act as the Dropkick key and must be stopped from scrolling
// the list.
export function consumesSpace(
  target: SpaceTargetState | null | undefined,
): boolean {
  if (!target) return false;
  if (target.tagName && SPACE_CONSUMING_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.("role") ?? null;
  return role !== null && SPACE_CONSUMING_ROLES.has(role);
}
