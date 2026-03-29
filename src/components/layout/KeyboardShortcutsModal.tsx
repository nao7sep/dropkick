// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const isMac =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const mod = isMac ? "\u2318" : "Ctrl";

const shortcuts: { label: string; keys: string }[] = [
  { label: "New task", keys: `${mod}+N` },
  { label: "New note on selected task", keys: `${mod}+Shift+N` },
  { label: "Dismiss selected tasks", keys: "Delete / Backspace" },
  { label: "Move task up", keys: `${mod}+\u2191` },
  { label: "Move task down", keys: `${mod}+\u2193` },
  { label: "Send to first in group", keys: `${mod}+Home` },
  { label: "Send to last in group", keys: `${mod}+End` },
  { label: "Navigate selection up", keys: "\u2191" },
  { label: "Navigate selection down", keys: "\u2193" },
  { label: "Extend selection", keys: "Shift+\u2191 / Shift+\u2193" },
  { label: "Next tab", keys: `${mod}+Tab` },
  { label: "Previous tab", keys: `${mod}+Shift+Tab` },
  { label: "Close tab", keys: `${mod}+W` },
  { label: "Unified view", keys: `${mod}+U` },
  { label: "Clear selection", keys: "Escape" },
  { label: "Rename tab", keys: "Double-click tab" },
  { label: "Zoom in / out", keys: `${mod}+Plus / ${mod}+Minus` },
  { label: "Reset zoom", keys: `${mod}+0` },
];

export function KeyboardShortcutsModal({
  onClose,
}: KeyboardShortcutsModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    >
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4">
          <table className="w-full">
            <tbody>
              {shortcuts.map(({ label, keys }) => (
                <tr key={label} className="border-b border-gray-50 last:border-0">
                  <td className="py-1.5 pr-4 text-sm text-gray-700">
                    {label}
                  </td>
                  <td className="py-1.5 text-right text-xs text-gray-400">
                    {keys}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-gray-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
