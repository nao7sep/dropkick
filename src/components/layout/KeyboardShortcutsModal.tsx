// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcutSections: {
  title: string;
  shortcuts: { label: string; keys: string }[];
}[] = [
  {
    title: "Task Actions",
    shortcuts: [
      { label: "New task", keys: "Cmd+N" },
      { label: "Focus new note field", keys: "Cmd+Shift+N" },
      { label: "Move selected tasks", keys: "Cmd+M" },
      { label: "Submit new task / settings", keys: "Cmd+Enter" },
      { label: "Save note", keys: "Cmd+Enter" },
      { label: "Set status to Pending", keys: "P" },
      { label: "Set status to Completed", keys: "C" },
      { label: "Set status to Dismissed", keys: "X" },
      { label: "Set priority to Default", keys: "0" },
      { label: "Set priority to Urgent", keys: "1" },
      { label: "Set priority to Important", keys: "2" },
      { label: "Set priority to Critical", keys: "3" },
      { label: "Set due date to today", keys: "T" },
      { label: "Set due date to tomorrow", keys: "Y" },
      { label: "Clear due date", keys: "N" },
      { label: "Dismiss selected tasks", keys: "Backspace / Delete" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { label: "Move task up", keys: "Cmd+Up" },
      { label: "Move task down", keys: "Cmd+Down" },
      { label: "Send to first in group", keys: "Cmd+Home" },
      { label: "Send to last in group", keys: "Cmd+End" },
      { label: "Navigate selection up", keys: "Up" },
      { label: "Navigate selection down", keys: "Down" },
      { label: "Extend selection", keys: "Shift+Up / Shift+Down" },
    ],
  },
  {
    title: "Tabs And App",
    shortcuts: [
      { label: "Next tab (Windows/Linux)", keys: "Ctrl+Tab" },
      { label: "Previous tab (Windows/Linux)", keys: "Ctrl+Shift+Tab" },
      { label: "Close tab", keys: "Cmd+W" },
      { label: "Unified view", keys: "Cmd+U" },
      { label: "Close active dialog / clear selection", keys: "Esc" },
      { label: "Rename tab", keys: "Double-click tab" },
      { label: "Zoom in / out", keys: "Cmd+Plus / Cmd+Minus" },
      { label: "Reset zoom", keys: "Cmd+0" },
    ],
  },
];

export function KeyboardShortcutsModal({
  onClose,
}: KeyboardShortcutsModalProps) {
  return (
    <AppModal
      title="Keyboard Shortcuts"
      onClose={onClose}
      maxWidth={920}
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
      <p className="mb-2 text-xs leading-5 text-gray-500">
        Shortcuts are shown with Cmd. On Windows, use Ctrl instead.
      </p>
      <p className="mb-3 text-xs leading-5 text-gray-500">
        Letter and number shortcuts apply to the current task selection.
      </p>
      <p className="mb-3 text-xs leading-5 text-gray-500">
        On macOS, Cmd+Tab is reserved by the system for app switching.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shortcutSections.map((section) => (
          <section
            key={section.title}
            className="rounded-lg border border-gray-100 bg-gray-50/60 p-4"
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              {section.title}
            </h3>
            <div className="space-y-2.5">
              {section.shortcuts.map(({ label, keys }) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-sm text-gray-700">{label}</span>
                  <span className="shrink-0 text-right text-xs font-medium text-sky-700">
                    {keys}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppModal>
  );
}
