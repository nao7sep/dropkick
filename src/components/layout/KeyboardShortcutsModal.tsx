// Keyboard shortcuts reference — lists all global shortcuts in a modal overlay.

import { AppModal } from "../shared/AppModal";
import { primaryModifierLabel } from "../../utils";
import type { TaskPriority, TaskStatus } from "../../models";
import { useI18n } from "../../i18n/I18nContext";
import { PRIORITY_LABELS, STATUS_LABELS } from "../../i18n/domainLabels";
import { message, type Message } from "../../i18n/translate";

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

// Primary modifier label for the running platform ("Cmd" on macOS, "Ctrl"
// elsewhere). Shortcut keys are built with this so the displayed text matches
// the actual bindings without any post-hoc string substitution. Bindings that
// are genuinely Ctrl on every platform (tab cycling — macOS reserves Cmd+Tab)
// keep a literal "Ctrl".
const mod = primaryModifierLabel;

// Descriptions are catalogue text; key names stay English in every language
// (keyboard-shortcut-conventions), except a gesture such as a double-click.
// The Dropkick heading is the product's own verb and stays as it is.
type ShortcutItem =
  | { kind: "heading"; label: Message | "Dropkick" }
  | { label: Message; keys: string | Message };

const setStatus = (status: TaskStatus) =>
  message("shortcuts.setStatus", { status: message(STATUS_LABELS[status]) });
const setPriority = (priority: TaskPriority) =>
  message("shortcuts.setPriority", { priority: message(PRIORITY_LABELS[priority]) });

const shortcutSections: { title: Message; shortcuts: ShortcutItem[] }[] = [
  {
    title: message("shortcuts.section.taskKeys"),
    shortcuts: [
      { kind: "heading", label: "Dropkick" },
      { label: message("shortcuts.dropkickSelected"), keys: "Space" },
      { kind: "heading", label: message("shortcuts.heading.status") },
      { label: setStatus("Pending"), keys: "P" },
      { label: setStatus("Completed"), keys: "C" },
      { label: setStatus("Dismissed"), keys: "X" },
      { label: message("shortcuts.deleteSelected"), keys: "Delete/Backspace" },
      { kind: "heading", label: message("shortcuts.heading.priority") },
      { label: setPriority("Default"), keys: "0" },
      { label: setPriority("Urgent"), keys: "1" },
      { label: setPriority("Important"), keys: "2" },
      { label: setPriority("Critical"), keys: "3" },
      { kind: "heading", label: message("shortcuts.heading.dueDate") },
      { label: message("shortcuts.dueToday"), keys: "D" },
      { label: message("shortcuts.dueTomorrow"), keys: "T" },
      { label: message("date.clear"), keys: "N" },
    ],
  },
  {
    title: message("shortcuts.section.view"),
    shortcuts: [
      { kind: "heading", label: message("shortcuts.heading.selection") },
      { label: message("shortcuts.selectUp"), keys: "Up" },
      { label: message("shortcuts.selectDown"), keys: "Down" },
      { label: message("shortcuts.selectEnds"), keys: "Home/End" },
      { label: message("shortcuts.selectPage"), keys: "PageUp/PageDown" },
      { label: message("shortcuts.extendSelection"), keys: "Shift+Up/Down" },
      { label: message("shortcuts.clearSelection"), keys: "Escape" },
      { kind: "heading", label: message("shortcuts.heading.reorder") },
      { label: message("shortcuts.moveUp"), keys: `${mod}+Up` },
      { label: message("shortcuts.moveDown"), keys: `${mod}+Down` },
      { label: message("shortcuts.sendFirst"), keys: `${mod}+Home` },
      { label: message("shortcuts.sendLast"), keys: `${mod}+End` },
      { kind: "heading", label: message("shortcuts.heading.display") },
      { label: message("shortcuts.zoomIn"), keys: `${mod}+Equal/Plus/Semicolon` },
      { label: message("shortcuts.zoomOut"), keys: `${mod}+Minus` },
      { label: message("shortcuts.zoomReset"), keys: `${mod}+0` },
    ],
  },
  {
    title: message("shortcuts.section.create"),
    shortcuts: [
      { kind: "heading", label: message("shortcuts.heading.createMove") },
      { label: message("shortcuts.newTask"), keys: `${mod}+N` },
      { label: message("shortcuts.moveSelected"), keys: `${mod}+M` },
      { label: message("shortcuts.focusNote"), keys: `${mod}+Shift+N` },
      { label: message("shortcuts.saveNote"), keys: `${mod}+Enter` },
      { label: message("shortcuts.saveNoteActionable"), keys: `${mod}+Shift+Enter` },
      { label: message("shortcuts.cancelNote"), keys: "Escape" },
      { kind: "heading", label: message("shortcuts.heading.tabs") },
      { label: message("shortcuts.nextTab"), keys: "Ctrl+Tab" },
      { label: message("shortcuts.previousTab"), keys: "Ctrl+Shift+Tab" },
      { label: message("shortcuts.switchTabs"), keys: "Left/Right" },
      { label: message("shortcuts.moveTab"), keys: "Shift+Left/Right" },
      { label: message("shortcuts.tabEnds"), keys: "Home/End" },
      { label: message("shortcuts.closeFocusedTab"), keys: "Delete/Backspace" },
      { label: message("shortcuts.closeTab"), keys: `${mod}+W` },
      { label: message("shortcuts.unified"), keys: `${mod}+U` },
      { label: message("shortcuts.renameTab"), keys: message("shortcuts.doubleClickTab") },
    ],
  },
  {
    title: message("shortcuts.section.dialogs"),
    shortcuts: [
      { kind: "heading", label: message("shortcuts.heading.newTask") },
      { label: message("shortcuts.createTask"), keys: `${mod}+Enter` },
      { label: setPriority("Default"), keys: `${mod}+0` },
      { label: setPriority("Urgent"), keys: `${mod}+1` },
      { label: setPriority("Important"), keys: `${mod}+2` },
      { label: setPriority("Critical"), keys: `${mod}+3` },
      { label: message("shortcuts.dueToday"), keys: `${mod}+D` },
      { label: message("shortcuts.dueTomorrow"), keys: `${mod}+T` },
      { label: message("date.clear"), keys: `${mod}+N` },
      { kind: "heading", label: message("shortcuts.heading.otherDialogs") },
      { label: message("shortcuts.openSettings"), keys: `${mod}+Comma` },
      { label: message("shortcuts.openHelp"), keys: `${mod}+Slash / Question` },
      { label: message("shortcuts.submit"), keys: `${mod}+Enter` },
      { label: message("shortcuts.closeDialog"), keys: "Escape" },
    ],
  },
];

// The body's height bound is the shell's own 90vh, reached by shrinking inside
// it rather than by a second viewport figure here. This surface carried 70vh,
// the tighter of the two, and that put its last rows out of reach at every
// window height: the four columns want 846 px, which 70vh does not cover until
// the window is 1209 px tall, where the shell's bound covers it at 1087.
export function KeyboardShortcutsModal({
  onClose,
}: KeyboardShortcutsModalProps) {
  const { t, text } = useI18n();
  return (
    <AppModal
      title={t("shortcuts.title")}
      onClose={onClose}
      describedById="shortcuts-modal-description"
      maxWidth={1160}
      passiveBodyLabel={t("shortcuts.contentLabel")}
      bodyClassName="min-h-0 flex-1 overflow-y-auto px-6 py-4"
      footerClassName="flex justify-end border-t border-border px-6 py-4"
      footer={
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-ink-soft hover:bg-background"
          >
            {t("common.close")}
          </button>
      }
    >
      <div id="shortcuts-modal-description" className="mb-3 shrink-0 space-y-1 text-xs leading-5 text-ink-muted">
        <p>{t("shortcuts.contextNote")}</p>
        <p>{t("shortcuts.cmdTabNote")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {shortcutSections.map((section) => (
          <section
            key={section.title.key}
            className="rounded-lg border border-border-subtle bg-background/60"
          >
            <h3 className="border-b border-border-subtle px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {text(section.title)}
            </h3>
            <div className="space-y-2 px-4 py-3">
              {section.shortcuts.map((item, index) =>
                "kind" in item ? (
                  <div
                    key={index}
                    className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted first:pt-0"
                  >
                    {typeof item.label === "string" ? item.label : text(item.label)}
                  </div>
                ) : (
                  <div
                    key={index}
                    className="flex items-start justify-between gap-4 border-b border-border-subtle pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-sm text-ink">{text(item.label)}</span>
                    <span className="shrink-0 text-right text-xs font-medium text-primary">
                      {typeof item.keys === "string" ? item.keys : text(item.keys)}
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
