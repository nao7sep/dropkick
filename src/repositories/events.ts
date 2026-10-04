// Subscriptions to events the Rust core or another window sends this one.

import { listen } from "@tauri-apps/api/event";
import { log, toErrorFields } from "./logging";

// Listens until the returned function is called, which may happen before the
// listener is registered.
export function subscribe<T>(event: string, listener: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  void listen<T>(event, ({ payload }) => listener(payload))
    .then((registered) => {
      if (stopped) registered();
      else unlisten = registered;
    })
    .catch((error) => log.warn("event listener failed", { event, ...toErrorFields(error) }));
  return () => {
    stopped = true;
    unlisten?.();
  };
}
