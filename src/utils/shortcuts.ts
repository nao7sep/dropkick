interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
}

interface ShortcutKeyState {
  key: string;
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

// Display label for the primary modifier key, for use in shortcut hints. The
// actual binding (hasPrimaryShortcutModifier) keys off metaKey on Apple and
// ctrlKey elsewhere; this keeps the on-screen text in sync with that.
export const primaryModifierLabel = isApplePlatform ? "Cmd" : "Ctrl";

export function hasPrimaryShortcutModifier(
  event: ShortcutModifierState,
): boolean {
  return isApplePlatform ? event.metaKey : event.ctrlKey;
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
