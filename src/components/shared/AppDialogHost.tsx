import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { useRef } from "react";
import { useDialogStore } from "../../state/dialog-store";

export function AppDialogHost() {
  const current = useDialogStore((s) => s.current);
  const confirmCurrent = useDialogStore((s) => s.confirmCurrent);
  const cancelCurrent = useDialogStore((s) => s.cancelCurrent);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleOpenChange = (open: boolean) => {
    if (open || !current) return;

    if (current.kind === "message") {
      confirmCurrent();
    } else {
      cancelCurrent();
    }
  };

  const isWarning = current?.tone === "warning";

  return (
    <Dialog.Root open={current !== null} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/30" />

        {current && (
          <Dialog.Content
            data-dropkick-interactive-layer=""
            className="fixed left-1/2 top-1/2 z-[101] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface shadow-xl focus:outline-none"
            onPointerDownOutside={(e) => e.preventDefault()}
            onOpenAutoFocus={(e) => {
              if (!current) return;
              e.preventDefault();
              if (current.kind === "confirm") {
                cancelRef.current?.focus();
              } else {
                confirmRef.current?.focus();
              }
            }}
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
