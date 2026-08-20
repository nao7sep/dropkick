import { getCurrentWindow } from "@tauri-apps/api/window";
import { log, toErrorFields } from "../../repositories";

// Non-dismissible halt shown when startup fails (app-state init, or a
// preferences/workspace load error). The app must not fall through to the main
// window — doing so would let the default in-memory state autosave over the
// user's files. The shell renders this root screen until the user quits and
// repairs the data directory by hand.
//
// This is a root surface, not a stacked modal: it replaces the whole app and is
// intentionally exempt from the *Modal/*Dialog naming rule. It still offers a
// labelled exit (Quit) so the user is never stuck with zero buttons.

type StartupErrorScreenProps = {
  message: string;
};

export function StartupErrorScreen({ message }: StartupErrorScreenProps) {
  function quit() {
    void getCurrentWindow()
      .destroy()
      // If destroy fails the user can still force-quit from the OS; there is no
      // safe in-app fallback that wouldn't risk a write. Record it so the failed
      // quit is not silent.
      .catch((e) => log.warn("quit destroy failed", toErrorFields(e)));
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="max-w-md rounded-lg bg-surface p-6 shadow-lg">
        <h2 className="mb-2 text-lg font-bold text-danger">Startup Error</h2>
        <p className="whitespace-pre-wrap text-sm text-ink-soft">{message}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            className="rounded-md bg-primary-solid px-4 py-2 text-sm font-medium text-ink-inverted transition-colors hover:bg-primary-solid-hover"
            onClick={quit}
          >
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
