interface ShortcutModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
}

interface ShortcutKeyState {
  key: string;
}

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
