// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcuts: { label: string; keys: string }[] = [
  { label: "New task", keys: "\u2318N" },
  { label: "New note on selected task", keys: "\u2318\u21e7N" },
  { label: "Move selected tasks", keys: "\u2318M" },
  { label: "Submit dialog", keys: "\u2318\u21a9" },
  { label: "Save note", keys: "\u2318\u21a9" },
  { label: "Dismiss selected tasks", keys: "\u232b" },
  { label: "Move task up", keys: "\u2318\u2191" },
  { label: "Move task down", keys: "\u2318\u2193" },
  { label: "Send to first in group", keys: "\u2318Home" },
  { label: "Send to last in group", keys: "\u2318End" },
  { label: "Navigate selection up", keys: "\u2191" },
  { label: "Navigate selection down", keys: "\u2193" },
  { label: "Extend selection", keys: "\u21e7\u2191 / \u21e7\u2193" },
  { label: "Next tab", keys: "\u2318Tab" },
  { label: "Previous tab", keys: "\u2318\u21e7Tab" },
  { label: "Close tab", keys: "\u2318W" },
  { label: "Unified view", keys: "\u2318U" },
  { label: "Clear selection", keys: "Esc" },
  { label: "Rename tab", keys: "Double-click tab" },
  { label: "Zoom in / out", keys: "\u2318+ / \u2318\u2212" },
  { label: "Reset zoom", keys: "\u23180" },
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
