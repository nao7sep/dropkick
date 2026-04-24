import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

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
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  bodyClassName?: string;
  footerClassName?: string;
  contentClassName?: string;
  contentProps?: DialogContentProps;
}

export function AppModal({
  title,
  onClose,
  onRequestClose,
  children,
  footer,
  maxWidth = 448,
  bodyClassName = "overflow-y-auto px-6 py-5",
  footerClassName = "flex justify-end gap-2 border-t border-gray-200 px-6 py-4",
  contentClassName = "",
  contentProps,
}: AppModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const { onOpenAutoFocus, ...restContentProps } = contentProps ?? {};

  // When a close guard is active, Escape and outside-click are intercepted and
  // routed through onRequestClose instead of triggering the default dismiss.
  // Outside-clicks that land inside another stacked dialog (marked with
  // data-dropkick-interactive-layer) are ignored — otherwise confirming the
  // guard's own confirmation dialog would re-trigger the close request.
  const escapeAndOutsideHandlers = onRequestClose
    ? {
        onEscapeKeyDown: (e: Event) => {
          e.preventDefault();
          onRequestClose();
        },
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
    : {};

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          ref={contentRef}
          aria-describedby={undefined}
          data-dropkick-interactive-layer=""
          className={`fixed left-1/2 top-1/2 z-[51] flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl focus:outline-none ${contentClassName}`}
          style={{ maxWidth }}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            if (e.defaultPrevented) return;
            e.preventDefault();
            contentRef.current?.focus();
          }}
          {...escapeAndOutsideHandlers}
          {...restContentProps}
        >
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-gray-800">
              {title}
            </Dialog.Title>
            {onRequestClose ? (
              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={onRequestClose}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            ) : (
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X size={18} />
                </button>
              </Dialog.Close>
            )}
          </div>

          <div className={bodyClassName}>{children}</div>

          {footer && <div className={footerClassName}>{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
