// Shared dirty-close routing for draft modals.
//
// The modal conventions require every close path — X button, Cancel, Escape,
// backdrop click, programmatic close — to funnel through ONE close function so
// the dirty guard can never be bypassed by one of them. This hook is that
// function: wire the returned `requestClose` to every close path of a modal
// that edits a draft, and pass it as AppModal's `onRequestClose`.
//
// When the draft is clean it closes immediately; when dirty it asks for
// confirmation through the app's shared dialog host and only closes if the user
// chooses to discard.

import { useCallback } from "react";
import { showUnsavedChangesConfirm } from "../repositories";

export function useDirtyClose(
  isDirty: boolean,
  onClose: () => void,
): () => Promise<void> {
  return useCallback(async () => {
    if (!isDirty) {
      onClose();
      return;
    }
    const discard = await showUnsavedChangesConfirm();
    if (discard) onClose();
  }, [isDirty, onClose]);
}
