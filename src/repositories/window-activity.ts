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

// Calls `listener` each time the native window gains focus. Returns the
// function that stops listening.
export function onWindowFocused(listener: () => void): () => void {
  if (!isTauri()) return () => {};
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => {
      if (payload) listener();
    })
    .then((stop) => {
      if (stopped) stop();
      else unlisten = stop;
    })
    .catch((error) => log.warn("window focus listener failed", toErrorFields(error)));
  return () => {
    stopped = true;
    unlisten?.();
  };
}

export function installWindowActivity(root: Element = document.documentElement): void {
  if (!isTauri()) return;
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => applyWindowActivity(root, payload))
    .catch((error) => log.warn("window focus listener failed", toErrorFields(error)));
}
