import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogStore } from "../../state/dialog-store";
import type { DialogRequest } from "../../state/dialog-store";

// Which control a request wants focused. A confirmation never focuses the
// destructive action; where BOTH choices destroy something, none of them does
// and the surface takes focus so a reflexive Enter falls flat
// (modal-dialog-conventions).
export type DialogFocusTarget = "confirm" | "cancel" | "surface";

export function dialogFocusTarget(request: DialogRequest): DialogFocusTarget {
  if (request.kind !== "confirm") return "confirm";
  return request.noSafeAction ? "surface" : "cancel";
}

export function AppDialogHost() {
  const current = useDialogStore((s) => s.current);
  const confirmCurrent = useDialogStore((s) => s.confirmCurrent);
  const cancelCurrent = useDialogStore((s) => s.cancelCurrent);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // State, not a ref: the focus effect below has to re-run when the surface
  // appears, and a ref assignment does not re-run anything.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (open || !current) return;

    if (current.kind === "message") {
      confirmCurrent();
      return;
    }

    // Where no action is safe, Escape and the backdrop do not choose one. Both
    // buttons destroy something different, so dismissing would silently pick
    // the destructive default — which is what focusing nothing already refuses
    // to do. Two reachable choices that each resolve the situation is a
    // decision, not a trap.
    if (current.noSafeAction) return;

    cancelCurrent();
  };

  const isWarning = current?.tone === "warning";

  // Apply the focus rule to EVERY request this host serves, not just the first.
  //
  // Radix fires `onOpenAutoFocus` on mount only, and the store advances its
  // queue by replacing `current` in one `set` — it never passes through null —
  // so `Dialog.Content` stays mounted and a queued request would inherit
  // whatever was focused before it (in practice the button the user just
  // clicked). `noSafeAction` and the safest-action default would then silently
  // not apply to the second dialog. Keying the rule to the REQUEST rather than
  // to mounting is what makes it hold for all of them; the request object is
  // fresh per request, so this runs once per request and never twice for one.
  //
  // `contentEl` is the second dependency because the two do not change on the
  // same commit in the other direction either: Radix mounts the surface through
  // Presence, one commit AFTER the store first sets `current`, so an effect
  // keyed on the request alone would run while the buttons do not exist yet and
  // focus nothing at all.
  useEffect(() => {
    if (!current || !contentEl) return;
    switch (dialogFocusTarget(current)) {
      case "confirm":
        confirmRef.current?.focus();
        break;
      case "cancel":
        cancelRef.current?.focus();
        break;
      case "surface":
        contentEl.focus();
        break;
    }
  }, [current, contentEl]);

  return (
    <Dialog.Root open={current !== null} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/30" />

        {current && (
          <Dialog.Content
            data-dropkick-interactive-layer=""
            className="fixed left-1/2 top-1/2 z-[101] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface shadow-xl focus:outline-none"
            onPointerDownOutside={(e) => e.preventDefault()}
            ref={setContentEl}
            tabIndex={-1}
            // The effect above owns focus for every request, including the
            // first; Radix's own mount-time autofocus would only fight it.
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    isWarning
                      ? "bg-warning-surface text-warning"
                      : "bg-primary-surface-strong text-primary"
                  }`}
                >
                  {isWarning ? <AlertTriangle size={18} /> : <Info size={18} />}
                </div>

                <Dialog.Title
                  className={`text-lg font-semibold ${
                    isWarning ? "text-warning-strong" : "text-ink-strong"
                  }`}
                >
                  {current.title}
                </Dialog.Title>
              </div>
            </div>

            <div className="px-6 py-5">
              <Dialog.Description asChild>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                  {current.body}
                </p>
              </Dialog.Description>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
              {current.kind === "confirm" && (
                <button
                  ref={cancelRef}
                  onClick={cancelCurrent}
                  className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
                >
                  {current.cancelLabel}
                </button>
              )}

              <button
                ref={confirmRef}
                onClick={confirmCurrent}
                className={`rounded-md px-4 py-2 text-sm text-ink-inverted ${
                  isWarning ? "bg-warning-solid hover:bg-warning-solid-strong" : "bg-primary-solid hover:bg-primary-solid-hover"
                }`}
              >
                {current.confirmLabel}
              </button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
