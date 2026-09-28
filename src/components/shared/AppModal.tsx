import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { isComposingEvent } from "../../hooks/useComposing";
import { passiveScrollRegionProps } from "../../utils";
import { useI18n } from "../../i18n/I18nContext";

type DialogContentProps = Omit<
  ComponentPropsWithoutRef<typeof Dialog.Content>,
  "children" | "className" | "style"
>;

interface AppModalProps {
  title: string;
  onClose: () => void;
  // When provided, replaces the default close behaviour for the X button,
  // Escape key, and outside-click. Use this to run an async guard (e.g. a
  // dirty-check confirmation) before actually closing.
  onRequestClose?: () => void;
  // When set, wires Radix's aria-describedby to this element id so screen
  // readers announce the modal's descriptive text. Leave unset (default) for
  // form modals whose body is all inputs — Radix then renders no Description
  // and the dialog opts out of aria-describedby without warning.
  describedById?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  bodyClassName?: string;
  footerClassName?: string;
  contentClassName?: string;
  contentProps?: DialogContentProps;
  // Informational bodies opt in to the shared keyboard-scroll owner. Forms keep
  // their fields as the focus and keyboard owners.
  passiveBodyLabel?: string;
  // The title stays the dialog's spoken name but is not drawn: a surface that
  // names itself in its own content (About) keeps only the close control in
  // its title band, pinned to the trailing corner, and that band drops its line
  // (modal-dialog-conventions).
  titleVisuallyHidden?: boolean;
  // False when the header has no close control to draw — a surface with
  // nothing to close back to (the startup picker), or one that always forces
  // an explicit choice through its footer's own buttons (a confirmation).
  // Escape and an outside click still run `onRequestClose` when one is given;
  // only a surface with neither does nothing, since there is no path to
  // reach for at all.
  closable?: boolean;
  // False when this surface has no page behind it to dim — the startup
  // picker's card sits directly on the app's own canvas, not over other
  // content. The overlay still occupies its layer (Dialog.Content's centring
  // depends on it existing), it just carries no tint.
  dimmed?: boolean;
  // The overlay's z-index; the content sits one above it. Raised for a
  // surface that must stack over an already-open AppModal, such as the
  // app-wide confirmation/message queue over a settings-style dialog.
  zIndexBase?: number;
  // False keeps an outside click fully inert even when `onRequestClose` is
  // set — the app-wide confirmation/message queue always forces an explicit
  // footer choice and never treats a stray click as one. Escape still runs
  // `onRequestClose` either way; only outside-click is affected.
  dismissOnOutsideClick?: boolean;
  // Overrides the title's ink colour — a danger or warning confirmation
  // tints its own title instead of the default strong ink.
  titleClassName?: string;
  // The dialog surface's own DOM node, once mounted — for a caller whose
  // focus rule includes "the surface itself" (a confirmation with no safe
  // default action), which needs the element `.focus()` is called on.
  onContentRef?: (element: HTMLDivElement | null) => void;
}

export function AppModal({
  title,
  onClose,
  onRequestClose,
  describedById,
  children,
  footer,
  maxWidth = 448,
  bodyClassName = "overflow-y-auto px-6 py-5",
  footerClassName = "flex items-center justify-end gap-2 border-t border-control-edge px-6 py-4",
  contentClassName = "",
  contentProps,
  passiveBodyLabel,
  titleVisuallyHidden = false,
  closable = true,
  dimmed = true,
  zIndexBase = 50,
  dismissOnOutsideClick = true,
  titleClassName,
  onContentRef,
}: AppModalProps) {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const { onOpenAutoFocus, ...restContentProps } = contentProps ?? {};

  // When a close guard is active, Escape and outside-click are intercepted and
  // routed through onRequestClose instead of triggering the default dismiss.
  // Outside-clicks that land inside another stacked dialog (marked with
  // data-dropkick-interactive-layer) are ignored — otherwise confirming the
  // guard's own confirmation dialog would re-trigger the close request.
  const escapeAndOutsideHandlers = {
    onEscapeKeyDown: (e: Event) => {
      // Escape belongs to the IME while a composition is active: it cancels the
      // pending candidate and falls back to kana. Radix's dismissable layer
      // matches `event.key === "Escape"` alone, on a document-CAPTURE listener
      // that runs ahead of every React handler in the tree, so this callback is
      // the only place a modal can stand down — and calling preventDefault() on
      // it is what stops the layer dismissing. Without this, cancelling a
      // conversion in the New Task title or a Settings field instead read the
      // preedit text as unsaved changes, opened the confirmation dialog, and
      // tore the composition down mid-word (text-input-ime-conventions).
      if (isComposingEvent(e as KeyboardEvent)) {
        e.preventDefault();
        return;
      }
      // A close guard always owns the dismiss, whether or not the header
      // draws a close control — a confirmation with no X still routes
      // Escape through its own queue-advancing logic.
      if (onRequestClose) {
        e.preventDefault();
        onRequestClose();
        return;
      }
      // No guard and nothing to close back to: Escape does nothing.
      if (!closable) {
        e.preventDefault();
        return;
      }
      // No close guard: let Radix's own dismiss run.
    },
    ...(!dismissOnOutsideClick
      ? {
          // Always inert regardless of onRequestClose: a surface that forces
          // an explicit footer choice never treats a stray outside click as
          // one (unlike Escape above, which still runs the guard).
          onInteractOutside: (e: Event) => e.preventDefault(),
        }
      : onRequestClose
      ? {
        onInteractOutside: (e: Event) => {
          e.preventDefault();
          // Ignore clicks that landed inside another stacked dialog layer
          // (e.g. the unsaved-changes confirmation that this modal itself
          // opened). Otherwise confirming the guard would re-trigger the
          // close request and queue a duplicate confirmation.
          const target = e.target as Element | null;
          const layer = target?.closest?.("[data-dropkick-interactive-layer]");
          if (layer && layer !== contentRef.current) return;
          onRequestClose();
        },
        }
      : !closable
      ? {
          // Same reasoning as Escape above: an outside click has nowhere to
          // dismiss to.
          onInteractOutside: (e: Event) => e.preventDefault(),
        }
      : {}),
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        {/* Tailwind's z-* utilities need a literal class in source to be
            generated, so a caller-supplied base goes through style instead —
            a plain arbitrary-value class string built from a prop is never
            actually seen by the scanner. */}
        <Dialog.Overlay
          className={`fixed inset-0 ${dimmed ? "bg-black/30" : ""}`}
          style={{ zIndex: zIndexBase }}
        />
        <Dialog.Content
          ref={(node) => {
            contentRef.current = node;
            onContentRef?.(node);
          }}
          aria-describedby={describedById}
          data-dropkick-interactive-layer=""
          className={`fixed left-1/2 top-1/2 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-dialog)] bg-surface shadow-xl focus:outline-none ${contentClassName}`}
          style={{ maxWidth, zIndex: zIndexBase + 1 }}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            e.preventDefault();
            // The surface, never the body — including when the body is a passive
            // scroll owner. The body reaches the modal's own edges, so its focus
            // ring draws a second border just inside the surface, and a reader
            // who opened this with the mouse never asked for one. It stays
            // reachable, and rings correctly, on a deliberate Tab.
            contentRef.current?.focus();
          }}
          {...escapeAndOutsideHandlers}
          {...restContentProps}
        >
          <div
            className={`flex min-h-14 shrink-0 items-center justify-between gap-3 px-6 py-3 ${
              titleVisuallyHidden ? "" : "border-b border-control-edge"
            }`}
          >
            <Dialog.Title
              className={
                titleVisuallyHidden
                  ? "sr-only"
                  : `text-base font-semibold ${titleClassName ?? "text-ink-strong"}`
              }
            >
              {title}
            </Dialog.Title>
            {!closable ? null : onRequestClose ? (
              <button
                type="button"
                aria-label={t("common.closeNamed", { title })}
                onClick={onRequestClose}
                className="dk-icon-btn -mr-2 ml-auto"
              >
                <X size={18} />
              </button>
            ) : (
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={t("common.closeNamed", { title })}
                  className="dk-icon-btn -mr-2 ml-auto"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            )}
          </div>

          <div
            {...(passiveBodyLabel
              ? passiveScrollRegionProps(passiveBodyLabel)
              : {})}
            className={`min-h-0 ${bodyClassName}`}
          >
            {children}
          </div>

          {footer && <div className={`shrink-0 ${footerClassName}`}>{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
