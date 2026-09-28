import { useEffect, useRef, useState } from "react";
import { useDialogStore } from "../../state/dialog-store";
import { AppModal } from "./AppModal";
import { Button } from "./Button";
import type { DialogRequest } from "../../state/dialog-store";
import { useI18n } from "../../i18n/I18nContext";

// Which control a request wants focused. A confirmation never focuses the
// destructive action; where BOTH choices destroy something, none of them does
// and the surface takes focus so a reflexive Enter falls flat
// (modal-dialog-conventions).
export type DialogFocusTarget = "confirm" | "cancel" | "surface";

export function dialogFocusTarget(request: DialogRequest): DialogFocusTarget {
  if (request.kind !== "confirm") return "confirm";
  return request.noSafeAction ? "surface" : "cancel";
}

const DESCRIPTION_ID = "app-dialog-host-description";

export function AppDialogHost() {
  const { text } = useI18n();
  const current = useDialogStore((s) => s.current);
  const confirmCurrent = useDialogStore((s) => s.confirmCurrent);
  const cancelCurrent = useDialogStore((s) => s.cancelCurrent);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // State, not a ref: the focus effect below has to re-run when the surface
  // appears, and a ref assignment does not re-run anything.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  // Escape routes through here (AppModal's onRequestClose); an outside click
  // never does (dismissOnOutsideClick={false} below) — a stray click outside
  // must not silently confirm or cancel anything.
  const requestClose = () => {
    if (!current) return;

    if (current.kind === "message") {
      confirmCurrent();
      return;
    }

    // Where no action is safe, Escape does not choose one either. Both
    // buttons destroy something different, so dismissing would silently pick
    // the destructive default — which is what focusing nothing already
    // refuses to do. Two reachable choices that each resolve the situation is
    // a decision, not a trap.
    if (current.noSafeAction) return;

    cancelCurrent();
  };

  const isWarning = current?.tone === "warning";
  const isDanger = current?.tone === "danger";

  // Apply the focus rule to EVERY request this host serves, not just the first.
  //
  // Radix fires `onOpenAutoFocus` on mount only, and the store advances its
  // queue by replacing `current` in one `set` — it never passes through null —
  // so the surface stays mounted (AppModal's own Dialog.Root never toggles
  // `open`; this component instead keeps rendering the same AppModal across
  // requests) and a queued request would inherit whatever was focused before
  // it (in practice the button the user just clicked). `noSafeAction` and the
  // safest-action default would then silently not apply to the second dialog.
  // Keying the rule to the REQUEST rather than to mounting is what makes it
  // hold for all of them; the request object is fresh per request, so this
  // runs once per request and never twice for one.
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

  if (!current) return null;

  return (
    <AppModal
      title={text(current.title)}
      // Never actually reached: onRequestClose (below) and dismissOnOutsideClick
      // together own every dismiss path this surface has.
      onClose={() => {}}
      onRequestClose={requestClose}
      dismissOnOutsideClick={false}
      // No close control: every request forces an explicit footer choice.
      closable={false}
      titleClassName={isDanger ? "text-danger-fg-strong" : isWarning ? "text-warning-strong" : undefined}
      describedById={DESCRIPTION_ID}
      onContentRef={setContentEl}
      // Stacks over an already-open AppModal (a settings-style dialog can
      // itself open a confirmation through this same host).
      zIndexBase={100}
      footer={
        <>
          {current.kind === "confirm" && (
            <Button ref={cancelRef} variant="secondary" onClick={cancelCurrent}>
              {text(current.cancelLabel)}
            </Button>
          )}

          {/* The commit of a danger confirmation is the app's one filled red;
              a caution dialog commits in amber; everything else is primary. */}
          <Button
            ref={confirmRef}
            variant={isDanger ? "danger-confirm" : isWarning ? "warning-confirm" : "primary"}
            onClick={confirmCurrent}
          >
            {text(current.confirmLabel)}
          </Button>
        </>
      }
    >
      <p id={DESCRIPTION_ID} className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">
        {text(current.body)}
      </p>
    </AppModal>
  );
}
