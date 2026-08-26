// Event and element parameter types are structural minimums so these pure
// predicates stay testable without a DOM (vitest runs them in the node
// environment). KeyboardEvent, MouseEvent, and HTMLElement all satisfy them.
type ModifierFlags = { metaKey: boolean; ctrlKey: boolean; altKey: boolean };
type KeyChord = ModifierFlags & { shiftKey: boolean; key: string };

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement?: ElementLike | null;
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

// Alt is excluded because Chromium delivers Windows AltGr as Ctrl+Alt.
export function hasPrimaryShortcutModifier(event: ModifierFlags): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

// The pointer-chord half: Cmd/Ctrl+Click toggle-select and friends test the
// command flags alone — no Alt exclusion, so Cmd+Alt+Click keeps working.
export function hasPointerCommandModifier(event: {
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return event.metaKey || event.ctrlKey;
}

// On macOS, Ctrl inside a text field belongs to the text system whatever the
// key is, so the Ctrl half of a dual-bound chord stands down there — one
// blanket test, no per-chord key list (keyboard-shortcut-conventions). The Cmd
// half is the binding and always fires. Literal-Ctrl chords (Ctrl+Tab) never
// pass through this: they are matched before it, on their own branch.
export function shadowsMacTextBinding(event: ModifierFlags): boolean {
  return isApplePlatform && event.ctrlKey && !event.metaKey;
}

// INPUT types that carry typed text; the rest (checkbox, radio, range, ...)
// consume no printable key and are not editable for chord purposes.
const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "number", "date",
  "datetime-local", "month", "time", "week",
]);

// One editable-target predicate for the whole app.
//
// The parentElement walk is precautionary, not load-bearing here: every
// editable surface in this app is a plain <textarea> or <input>, whose event
// target is the element itself, so a leaf test would currently suffice. It is
// kept because this predicate guards chords that destroy work — Delete, status
// changes — while the user is typing, and the day a rich-text editor arrives
// its event target IS a descendant of the contenteditable, where a leaf test
// silently lets every chord through.
export function isEditableTarget(
  target: ElementLike | null | undefined,
): boolean {
  let current: ElementLike | null | undefined = target;
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

// The macOS Ctrl stand-down as one call, rather than a two-term conjunction
// every dispatch site has to remember to spell in full. The convention requires
// this test wherever a dual-bound chord is matched — not only at the main
// dispatcher — and a named predicate is what makes a missing one visible.
export function standsDownForMacText(
  event: ModifierFlags,
  target: ElementLike | null | undefined,
): boolean {
  return shadowsMacTextBinding(event) && isEditableTarget(target);
}


// Some webview/platform combinations report printable keys in lowercase even when
// Shift is held with a command-style shortcut. Normalize letter keys so shortcut
// matching does not depend on uppercase/lowercase event.key behavior.
export function matchesShortcutKey(
  event: { key: string },
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
export function isOpenSettingsShortcut(event: KeyChord): boolean {
  return (
    hasPrimaryShortcutModifier(event) &&
    !event.shiftKey &&
    event.key === ","
  );
}

/** What a keystroke inside an open note editor means, or null to let the
 *  textarea have it.
 *
 *  Kept here rather than inline in the component so the chord table is one
 *  testable thing: the edit path previously read only the modifier and Enter and
 *  ignored Shift entirely, so the documented "save as actionable" chord silently
 *  saved without flagging — a discrepancy no test could see while the decision
 *  lived inside a JSX handler.
 *
 *  IME composition is deliberately NOT considered here. It lives on a ref the
 *  caller owns, and the caller checks it after this returns, so a composing
 *  Enter or Escape never reaches an action. */
export type NoteEditorAction = "save" | "save-actionable" | "cancel";

export function noteEditorAction(event: KeyChord): NoteEditorAction | null {
  if (event.key === "Escape") return "cancel";
  if (hasPrimaryShortcutModifier(event) && event.key === "Enter") {
    // Ctrl+Enter is insertLineBreak: on macOS — leave it to the textarea.
    if (shadowsMacTextBinding(event)) return null;
    return event.shiftKey ? "save-actionable" : "save";
  }
  return null;
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
export function isOpenShortcutsHelpShortcut(event: KeyChord): boolean {
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
export function tabCycleDirection(event: KeyChord): 1 | -1 | null {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.key !== "Tab") {
    return null;
  }
  return event.shiftKey ? -1 : 1;
}

// True when the focused element should keep Space for itself. Everywhere else
// Space is free to act as the Dropkick key and must be stopped from scrolling
// the list.
export function consumesSpace(
  target: ElementLike | null | undefined,
): boolean {
  if (!target) return false;
  if (target.tagName && SPACE_CONSUMING_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.("role") ?? null;
  return role !== null && SPACE_CONSUMING_ROLES.has(role);
}

// The task-level permanent deletion key. Both event values are accepted because
// the ordinary macOS key labelled Delete arrives in the webview as Backspace.
// Modified variants belong to the platform or another command, and repeat must
// not queue confirmations or delete more than the selection the user reviewed.
export function isTaskDeletionShortcut(event: KeyChord & { repeat: boolean }): boolean {
  return (
    (event.key === "Delete" || event.key === "Backspace") &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat
  );
}
