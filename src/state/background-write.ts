// What happens when a write the user did not explicitly ask for fails.
//
// View-state changes persist as a side effect of ordinary interaction — dragging
// the divider or zooming — so there is no "Save" whose failure could be reported
// in place. Left unguarded, the rejection escaped to the global unhandled-rejection
// handler and the change was silently absent at the next launch. Workspace writes
// own a persistent result in workspace-store because a failed tab reorder must
// also restore the durable order.
//
// A modal is the wrong weight for this: it would interrupt a click the user has
// already moved on from, and a genuinely broken disk would produce one per
// interaction. A toast says it once, where the user is looking, without taking
// the focus — and the log carries the detail.
//
// Note drafts deliberately do NOT come through here: they write through every
// few seconds while the user types, so even a toast would be a firehose, and
// their own module documents that trade.

import { log, toErrorFields } from "../repositories";
import { useToastStore } from "./toast-store";

export async function guardBackgroundWrite(
  what: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (e) {
    log.error("background write failed", { what, ...toErrorFields(e) });
    useToastStore.getState().showToast(`${what} could not be saved.`);
  }
}
