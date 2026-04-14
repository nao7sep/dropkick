// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcuts: { label: string; keys: string }[] = [
  { label: "New task", keys: "Cmd+N" },
  { label: "Focus new note field", keys: "Cmd+Shift+N" },
  { label: "Move selected tasks", keys: "Cmd+M" },
  { label: "Submit new task / settings", keys: "Cmd+Enter" },
  { label: "Save note", keys: "Cmd+Enter" },
  { label: "Dismiss selected tasks", keys: "Backspace / Delete" },
  { label: "Move task up", keys: "Cmd+Up" },
  { label: "Move task down", keys: "Cmd+Down" },
  { label: "Send to first in group", keys: "Cmd+Home" },
  { label: "Send to last in group", keys: "Cmd+End" },
  { label: "Navigate selection up", keys: "Up" },
  { label: "Navigate selection down", keys: "Down" },
  { label: "Extend selection", keys: "Shift+Up / Shift+Down" },
  { label: "Next tab", keys: "Cmd+Tab" },
  { label: "Previous tab", keys: "Cmd+Shift+Tab" },
  { label: "Close tab", keys: "Cmd+W" },
  { label: "Unified view", keys: "Cmd+U" },
  { label: "Clear selection", keys: "Esc" },
  { label: "Rename tab", keys: "Double-click tab" },
  { label: "Zoom in / out", keys: "Cmd+Plus / Cmd+Minus" },
  { label: "Reset zoom", keys: "Cmd+0" },
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
        Shortcuts are shown with Cmd. On Windows, use Ctrl instead.
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
