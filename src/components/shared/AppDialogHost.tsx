import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { useDialogStore } from "../../state/dialog-store";

export function AppDialogHost() {
  const current = useDialogStore((s) => s.current);
  const confirmCurrent = useDialogStore((s) => s.confirmCurrent);
  const cancelCurrent = useDialogStore((s) => s.cancelCurrent);

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
            className="fixed left-1/2 top-1/2 z-[101] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white shadow-xl focus:outline-none"
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <div className="border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    isWarning
                      ? "bg-amber-100 text-amber-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {isWarning ? <AlertTriangle size={18} /> : <Info size={18} />}
                </div>

                <Dialog.Title
                  className={`text-lg font-semibold ${
                    isWarning ? "text-amber-900" : "text-gray-800"
                  }`}
                >
                  {current.title}
                </Dialog.Title>
              </div>
            </div>

            <div className="px-6 py-5">
              <Dialog.Description asChild>
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">
                  {current.body}
                </p>
              </Dialog.Description>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              {current.kind === "confirm" && (
                <button
                  onClick={cancelCurrent}
                  className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  {current.cancelLabel}
                </button>
              )}

              <button
                onClick={confirmCurrent}
                className={`rounded-md px-4 py-2 text-sm text-white ${
                  isWarning ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
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
