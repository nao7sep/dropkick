// New Task modal — opened via the primary new-task shortcut.

import { useState, useRef, useMemo } from "react";
import type { TaskPriority } from "../../models";
import {
  hasPrimaryShortcutModifier,
  matchesShortcutKey,
  singleLine,
  multiline,
  todayInTimezone,
  tomorrowInTimezone,
  shadowsMacTextBinding,
  isEditableTarget,
} from "../../utils";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useTaskListStore } from "../../state/task-list-store";
import { notSaved } from "../../state/action-result";
import { usePreferencesStore } from "../../state/preferences-store";
import { DatePicker } from "../shared/DatePicker";
import { AppModal } from "../shared/AppModal";
import { Button } from "../shared/Button";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useAutoGrow } from "../../hooks/useAutoGrow";
import { useDirtyClose } from "../../hooks/useDirtyClose";
import { useI18n } from "../../i18n/I18nContext";
import { PRIORITY_LABELS } from "../../i18n/domainLabels";
import type { Message } from "../../i18n/translate";

interface NewTaskModalProps {
  currentFilePath: string;
  isUnifiedView: boolean;
  onClose: () => void;
}

export function NewTaskModal({
  currentFilePath,
  isUnifiedView,
  onClose,
}: NewTaskModalProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addNewTask = useTaskListStore((s) => s.addNewTask);
  const timezone = usePreferencesStore((s) => s.preferences.timezone);

  const fileTabs = workspace.openTabs.filter((t) => !t.isUnifiedView);

  // In unified view, don't auto-select — require explicit choice.
  const defaultTarget =
    !isUnifiedView && currentFilePath ? currentFilePath : "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Default");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState(defaultTarget);
  // submittingRef is the synchronous guard against rapid double-clicks;
  // `submitting` (state) drives the disabled-button render. See MoveTasksModal
  // for the same pattern.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [targetError, setTargetError] = useState(false);
  const { t, text } = useI18n();
  const [actionError, setActionError] = useState<Message | null>(null);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const targetSelectRef = useRef<HTMLSelectElement>(null);
  const composing = useComposing();
  const autoGrowTitle = useAutoGrow(titleRef);
  const autoGrowDesc = useAutoGrow(descRef);

  const canCreate = targetFile !== "" && fileTabs.length > 0;

  const isDirty = useMemo(
    () =>
      title !== "" ||
      description !== "" ||
      priority !== "Default" ||
      dueDate !== null ||
      targetFile !== defaultTarget,
    [title, description, priority, dueDate, targetFile, defaultTarget],
  );

  // Single close guard for every close path (X, Cancel, Escape, backdrop).
  const handleRequestClose = useDirtyClose(isDirty, onClose);

  const handleCreate = async () => {
    if (submittingRef.current) return;
    if (!canCreate) {
      if (fileTabs.length > 0 && targetFile === "") {
        setTargetError(true);
        targetSelectRef.current?.focus();
      }
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await addNewTask(targetFile, {
        title: singleLine(title, { minify: true }),
        description: multiline(description),
        priority,
        dueDate,
      });

      if (result.status === "success") {
        onClose();
      } else if (notSaved(result)) {
        setActionError(result.message);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || !hasPrimaryShortcutModifier(e)) return;

    // Primary modifier + Enter submits from anywhere in the modal — except that the
    // Ctrl half is Cocoa's insertLineBreak: while the caret is in a text field, so it
    // yields there and Cmd+Enter carries the binding (keyboard-shortcut-conventions).
    if (e.key === "Enter") {
      if (shadowsMacTextBinding(e) && isEditableTarget(e.target as HTMLElement | null)) return;
      if (isComposingKeyboardEvent(composing.composingRef, e)) return;
      e.preventDefault();
      handleCreate();
      return;
    }

    if (matchesShortcutKey(e, "0")) {
      e.preventDefault();
      setPriority("Default");
      return;
    }

    if (matchesShortcutKey(e, "1")) {
      e.preventDefault();
      setPriority("Urgent");
      return;
    }

    if (matchesShortcutKey(e, "2")) {
      e.preventDefault();
      setPriority("Important");
      return;
    }

    if (matchesShortcutKey(e, "3")) {
      e.preventDefault();
      setPriority("Critical");
      return;
    }

    // D = toDay, T = Tomorrow, matching the list-review keys (with the modifier).
    if (matchesShortcutKey(e, "d")) {
      e.preventDefault();
      setDueDate(todayInTimezone(timezone));
      return;
    }

    if (matchesShortcutKey(e, "t")) {
      e.preventDefault();
      setDueDate(tomorrowInTimezone(timezone));
      return;
    }

    if (matchesShortcutKey(e, "n")) {
      e.preventDefault();
      setDueDate(null);
    }
  };

  const fileLabel = (path: string) => {
    const parts = path.split(/[\\/]/);
    return (parts[parts.length - 1] ?? "").replace(/\.json$/, "");
  };

  return (
    <AppModal
      title={t("newTask.title")}
      onClose={onClose}
      onRequestClose={handleRequestClose}
      maxWidth={448}
      bodyClassName="space-y-4 overflow-y-auto px-6 py-5"
      footer={
        <>
          <Button onClick={handleRequestClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canCreate || submitting}>
            {t("newTask.create")}
          </Button>
        </>
      }
      contentProps={{
        onKeyDown: handleKeyDown,
        onOpenAutoFocus: (e) => {
          e.preventDefault();
          titleRef.current?.focus();
        },
      }}
    >
      {actionError ? (
        <p role="alert" className="text-sm text-danger">
          {text(actionError)}
        </p>
      ) : null}

      {/* Target list */}
      {fileTabs.length > 0 && (
        <div>
          <label className="dk-label">
            {t("newTask.list")}
          </label>
          <select
            ref={targetSelectRef}
            aria-invalid={targetError}
            aria-describedby={targetError ? "new-task-target-error" : undefined}
            value={targetFile}
            onChange={(e) => {
              setTargetFile(e.target.value);
              setTargetError(false);
            }}
            className={`dk-field w-full ${targetError ? "bg-danger-surface" : ""}`}
          >
            {!targetFile && (
              <option value="" disabled>
                {t("newTask.selectList")}
              </option>
            )}
            {fileTabs.map((tab) => (
              <option key={tab.filePath} value={tab.filePath}>
                {tab.displayName || fileLabel(tab.filePath)}
              </option>
            ))}
          </select>
          {targetError ? (
            <p id="new-task-target-error" role="alert" className="mt-1 text-xs text-danger">
              {t("newTask.listRequired")}
            </p>
          ) : null}
        </div>
      )}

      {fileTabs.length === 0 && (
        <p className="text-xs text-danger">
          {t("newTask.noLists")}
        </p>
      )}

      {/* Title */}
      <div>
        <label className="dk-label">
          {t("newTask.titleLabel")}
        </label>
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            autoGrowTitle();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              handleCreate();
            }
          }}
          {...composing.handlers}
          placeholder={t("newTask.titlePlaceholder")}
          rows={1}
          className="dk-field dk-field-multi block w-full resize-none"
        />
      </div>

      {/* Description */}
      <div>
        <label className="dk-label">
          {t("newTask.description")}
        </label>
        <textarea
          ref={descRef}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            autoGrowDesc();
          }}
          placeholder={t("newTask.descriptionPlaceholder")}
          rows={3}
          className="dk-field dk-field-multi block w-full resize-none"
        />
      </div>

      {/* Priority and Due date — side by side */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <label className="dk-label">
            {t("newTask.priority")}
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="dk-field w-full"
          >
            {(["Default", "Urgent", "Important", "Critical"] as const).map((value) => (
              <option key={value} value={value}>
                {t(PRIORITY_LABELS[value])}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="dk-label">
            {t("newTask.dueDate")}
          </label>
          <DatePicker value={dueDate} onChange={setDueDate} popoverPosition="top" />
        </div>
      </div>
    </AppModal>
  );
}
