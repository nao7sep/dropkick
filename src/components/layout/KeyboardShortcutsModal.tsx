// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcuts: { label: string; keys: string }[] = [
  { label: "New task", keys: "\u2318N" },
  { label: "Focus new note field", keys: "\u2318\u21e7N" },
  { label: "Move selected tasks", keys: "\u2318M" },
  { label: "Submit new task / settings", keys: "\u2318\u21a9" },
  { label: "Save note", keys: "\u2318\u21a9" },
  { label: "Dismiss selected tasks", keys: "\u232b / Delete" },
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
  return (
    <AppModal
      title="Keyboard Shortcuts"
      onClose={onClose}
      maxWidth={384}
      bodyClassName="overflow-y-auto px-6 py-4"
      footerClassName="flex justify-end border-t border-gray-200 px-6 py-4"
      footer={
          <button
            onClick={onClose}
            className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Close
          </button>
      }
    >
      <p className="mb-3 text-xs leading-5 text-gray-500">
        Shortcuts are shown in macOS notation. On Windows, use Control
        where Command is shown. On macOS, some combinations may still
        respond more reliably with Control.
      </p>
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
    </AppModal>
  );
}
