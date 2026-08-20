// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";
import { primaryModifierLabel } from "../../utils";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

// Primary modifier label for the running platform ("Cmd" on macOS, "Ctrl"
// elsewhere). Shortcut keys are built with this so the displayed text matches
// the actual bindings without any post-hoc string substitution. Bindings that
// are genuinely Ctrl on every platform (tab cycling — macOS reserves Cmd+Tab)
// keep a literal "Ctrl".
const mod = primaryModifierLabel;

const shortcutSections: {
  title: string;
  shortcuts: ({ kind: "heading"; label: string } | { label: string; keys: string })[];
}[] = [
  {
    title: "Task keys",
    shortcuts: [
      { kind: "heading", label: "Dropkick" },
      { label: "Dropkick selected tasks", keys: "Space" },
      { kind: "heading", label: "Status" },
      { label: "Set status to Pending", keys: "P" },
      { label: "Set status to Completed", keys: "C" },
      { label: "Set status to Dismissed", keys: "X" },
      { label: "Dismiss selected tasks", keys: "Backspace/Delete" },
      { kind: "heading", label: "Priority" },
      { label: "Set priority to Default", keys: "0" },
      { label: "Set priority to Urgent", keys: "1" },
      { label: "Set priority to Important", keys: "2" },
      { label: "Set priority to Critical", keys: "3" },
      { kind: "heading", label: "Due date" },
      { label: "Set due date to today", keys: "D" },
      { label: "Set due date to tomorrow", keys: "T" },
      { label: "Clear due date", keys: "N" },
    ],
  },
  {
    title: "View & navigate",
    shortcuts: [
      { kind: "heading", label: "Selection" },
      { label: "Navigate selection up", keys: "Up" },
      { label: "Navigate selection down (into Handled)", keys: "Down" },
      { label: "Jump to first / last task", keys: "Home/End" },
      { label: "Move selection by a page", keys: "PageUp/PageDown" },
      { label: "Extend selection", keys: "Shift+Up/Down" },
      { label: "Clear selection", keys: "Escape" },
      { kind: "heading", label: "Reorder" },
      { label: "Move task up", keys: `${mod}+Up` },
      { label: "Move task down", keys: `${mod}+Down` },
      { label: "Send to first in group", keys: `${mod}+Home` },
      { label: "Send to last in group", keys: `${mod}+End` },
      { kind: "heading", label: "Display" },
      { label: "Toggle dark mode", keys: `${mod}+Shift+D` },
      { label: "Zoom in", keys: `${mod}+Equal/Plus/Semicolon` },
      { label: "Zoom out", keys: `${mod}+Minus` },
      { label: "Reset zoom", keys: `${mod}+0` },
    ],
  },
  {
    title: "Create & tabs",
    shortcuts: [
      { kind: "heading", label: "Create and move" },
      { label: "New task", keys: `${mod}+N` },
      { label: "Move selected tasks", keys: `${mod}+M` },
      { label: "Focus new note field", keys: `${mod}+Shift+N` },
      { label: "Save note", keys: `${mod}+Enter` },
      { label: "Save note as actionable", keys: `${mod}+Shift+Enter` },
      { label: "Cancel note editing", keys: "Escape" },
      { kind: "heading", label: "Tabs" },
      { label: "Next tab", keys: "Ctrl+Tab" },
      { label: "Previous tab", keys: "Ctrl+Shift+Tab" },
      { label: "Switch tabs (tab bar focused)", keys: "Left/Right" },
      { label: "First / last tab (tab bar focused)", keys: "Home/End" },
      { label: "Close the focused tab", keys: "Delete/Backspace" },
      { label: "Close tab", keys: `${mod}+W` },
      { label: "Unified view", keys: `${mod}+U` },
      { label: "Rename tab", keys: "Double-click tab" },
    ],
  },
  {
    title: "Dialogs",
    shortcuts: [
      { kind: "heading", label: "New Task" },
      { label: "Create task", keys: `${mod}+Enter` },
      { label: "Set priority to Default", keys: `${mod}+0` },
      { label: "Set priority to Urgent", keys: `${mod}+1` },
      { label: "Set priority to Important", keys: `${mod}+2` },
      { label: "Set priority to Critical", keys: `${mod}+3` },
      { label: "Set due date to today", keys: `${mod}+D` },
      { label: "Set due date to tomorrow", keys: `${mod}+T` },
      { label: "Clear due date", keys: `${mod}+N` },
      { kind: "heading", label: "Other dialogs" },
      { label: "Open settings", keys: `${mod}+Comma` },
      { label: "Open this shortcuts help", keys: `${mod}+Slash / Question` },
      { label: "Submit settings / move", keys: `${mod}+Enter` },
      { label: "Close active dialog", keys: "Escape" },
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
      describedById="shortcuts-modal-description"
      maxWidth={1160}
      bodyClassName="flex max-h-[70vh] min-h-0 flex-col overflow-hidden px-6 py-4"
      footerClassName="flex justify-end border-t border-border px-6 py-4"
      footer={
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            Close
          </button>
      }
    >
      <div id="shortcuts-modal-description" className="mb-3 shrink-0 space-y-1 text-xs leading-5 text-ink-muted">
        <p>Shortcuts can change meaning by context; modal shortcuts apply only inside that modal.</p>
        <p>On macOS, Cmd+Tab is reserved by the system for app switching.</p>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {shortcutSections.map((section) => (
          <section
            key={section.title}
            className="flex min-h-0 flex-col rounded-lg border border-border-subtle bg-background/60"
          >
            <h3 className="shrink-0 border-b border-border-subtle px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {section.title}
            </h3>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {section.shortcuts.map((item) =>
                "kind" in item ? (
                  <div
                    key={item.label}
                    className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint first:pt-0"
                  >
                    {item.label}
                  </div>
                ) : (
                  <div
                    key={item.label}
                    className="flex items-start justify-between gap-4 border-b border-border-subtle pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-sm text-ink">{item.label}</span>
                    <span className="shrink-0 text-right text-xs font-medium text-primary">
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
