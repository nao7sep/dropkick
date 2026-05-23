// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

const shortcutSections: {
  title: string;
  shortcuts: ({ kind: "heading"; label: string } | { label: string; keys: string })[];
}[] = [
  {
    title: "Task List",
    shortcuts: [
      { kind: "heading", label: "Create and move" },
      { label: "New task", keys: "Cmd+N" },
      { label: "Move selected tasks", keys: "Cmd+M" },
      { label: "Focus new note field", keys: "Cmd+Shift+N" },
      { label: "Save note", keys: "Cmd+Enter" },
      { label: "Save note as actionable", keys: "Cmd+Shift+Enter" },
      { kind: "heading", label: "Status" },
      { label: "Set status to Pending", keys: "P" },
      { label: "Set status to Completed", keys: "C" },
      { label: "Set status to Dismissed", keys: "X" },
      { label: "Dismiss selected tasks", keys: "Backspace / Delete" },
      { kind: "heading", label: "Priority" },
      { label: "Set priority to Default", keys: "0" },
      { label: "Set priority to Urgent", keys: "1" },
      { label: "Set priority to Important", keys: "2" },
      { label: "Set priority to Critical", keys: "3" },
      { kind: "heading", label: "Due date" },
      { label: "Set due date to today", keys: "T" },
      { label: "Set due date to tomorrow", keys: "Y" },
      { label: "Clear due date", keys: "N" },
      { kind: "heading", label: "Selection" },
      { label: "Navigate selection up", keys: "Up" },
      { label: "Navigate selection down", keys: "Down" },
      { label: "Extend selection", keys: "Shift+Up / Shift+Down" },
      { label: "Clear selection", keys: "Esc" },
      { kind: "heading", label: "Reorder" },
      { label: "Move task up", keys: "Cmd+Up" },
      { label: "Move task down", keys: "Cmd+Down" },
      { label: "Send to first in group", keys: "Cmd+Home" },
      { label: "Send to last in group", keys: "Cmd+End" },
    ],
  },
  {
    title: "Dialogs",
    shortcuts: [
      { kind: "heading", label: "New Task" },
      { label: "Create task", keys: "Cmd+Enter" },
      { label: "Set priority to Default", keys: "Cmd+0" },
      { label: "Set priority to Urgent", keys: "Cmd+1" },
      { label: "Set priority to Important", keys: "Cmd+2" },
      { label: "Set priority to Critical", keys: "Cmd+3" },
      { label: "Set due date to today", keys: "Cmd+T" },
      { label: "Set due date to tomorrow", keys: "Cmd+Y" },
      { label: "Clear due date", keys: "Cmd+N" },
      { kind: "heading", label: "Other dialogs" },
      { label: "Submit settings / move", keys: "Cmd+Enter" },
      { label: "Close active dialog", keys: "Esc" },
    ],
  },
  {
    title: "Tabs And App",
    shortcuts: [
      { kind: "heading", label: "Tabs" },
      { label: "Next tab (Windows/Linux)", keys: "Ctrl+Tab" },
      { label: "Previous tab (Windows/Linux)", keys: "Ctrl+Shift+Tab" },
      { label: "Close tab", keys: "Cmd+W" },
      { label: "Unified view", keys: "Cmd+U" },
      { label: "Rename tab", keys: "Double-click tab" },
      { kind: "heading", label: "Display" },
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
      bodyClassName="flex max-h-[70vh] min-h-0 flex-col overflow-hidden px-6 py-4"
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
      <div className="mb-3 shrink-0 space-y-1 text-xs leading-5 text-gray-500">
        <p>Shortcuts are shown with Cmd. On Windows, use Ctrl instead.</p>
        <p>Shortcuts can change meaning by context; modal shortcuts apply only inside that modal.</p>
        <p>On macOS, Cmd+Tab is reserved by the system for app switching.</p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-4 md:grid-cols-3">
        {shortcutSections.map((section) => (
          <section
            key={section.title}
            className="flex min-h-0 flex-col rounded-lg border border-gray-100 bg-gray-50/60"
          >
            <h3 className="shrink-0 border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
              {section.title}
            </h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {section.shortcuts.map((item) =>
                "kind" in item ? (
                  <div
                    key={item.label}
                    className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 first:pt-0"
                  >
                    {item.label}
                  </div>
                ) : (
                  <div
                    key={item.label}
                    className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-sm text-gray-700">{item.label}</span>
                    <span className="shrink-0 text-right text-xs font-medium text-sky-700">
                      {item.keys}
                    </span>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </AppModal>
  );
}
