// The focus ring quiets while the window is inactive (interface-styling
// conventions). Inside a webview the page's own focus is not a reliable signal
// for that, so the native window's focus events decide, marked on the root
// where App.css reads it (the same approach as QuickDeck).

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { log, toErrorFields } from "./logging";

export function applyWindowActivity(
  root: Pick<Element, "toggleAttribute">,
  active: boolean,
): void {
  root.toggleAttribute("data-window-inactive", !active);
}

export function installWindowActivity(root: Element = document.documentElement): void {
  if (!isTauri()) return;
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => applyWindowActivity(root, payload))
    .catch((error) => log.warn("window focus listener failed", toErrorFields(error)));
}
