// Single task detail — shown in right pane when exactly 1 task is selected.
// All fields are editable inline. Notes are listed newest first.

import { useState, useRef, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle,
  Info,
  Trash2,
  X,
} from "lucide-react";
import type { Task, TaskStatus, TaskPriority, NoteDto, NoteActionability } from "../../models";
import type { ActionResult } from "../../state";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { showMessage, showNoteDeletionConfirm } from "../../repositories";
import {
  formatTimestamp,
  formatDueDate,
  singleLine,
  multiline,
  noteEditorAction,
  primaryModifierLabel,
  taskKey,
  taskSelectionKey,
  statusAdvancesSelection,
} from "../../utils";
import { DatePicker } from "../shared/DatePicker";
import { Toolbar } from "../shared/Toolbar";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useNoteDraftStore } from "../../state/note-draft-store";
import { composerDraftKey, editorDraftKey } from "../../services";
import { useAutoGrow } from "../../hooks/useAutoGrow";
import { useDirtyClose } from "../../hooks/useDirtyClose";
import { useTaskDeletion } from "../../hooks/useTaskDeletion";

interface TaskDetailProps {
  task: Task;
  filePath: string;
  isUnifiedView: boolean;
  nextActiveTaskKey: string | null;
  focusNewNoteSignal: number;
}

export function TaskDetail({
  task,
  filePath,
  isUnifiedView,
  nextActiveTaskKey,
  focusNewNoteSignal,
}: TaskDetailProps) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const updateDescription = useTaskListStore((s) => s.updateDescription);
  const setStatusAction = useTaskListStore((s) => s.setStatus);
  const setPriority = useTaskListStore((s) => s.setPriority);
  const setDueDate = useTaskListStore((s) => s.setDueDate);
  const addNewNote = useTaskListStore((s) => s.addNewNote);
  const kickDistances = preferences.kickDistances;
  const kick = useTaskListStore((s) => s.kick);
  const sendToFirst = useTaskListStore((s) => s.sendToFirst);
  const sendToLast = useTaskListStore((s) => s.sendToLast);
  const dropkick = useTaskListStore((s) => s.dropkick);
  const moveTasks = useTaskListStore((s) => s.moveTasks);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [titleDraft, setTitleDraft] = useState(task.title);
  const [descDraft, setDescDraft] = useState(task.description);
  const [moveTarget, setMoveTarget] = useState("");

  // The new-note composer draft lives in the draft store, keyed by task id, so
  // it survives this component unmounting (task switch, tab cycle, bulk action),
  // is restored when the task is selected again, and — because the store writes
  // through to disk — survives quitting the app.
  const newNoteContent = useNoteDraftStore(
    (s) => s.drafts[composerDraftKey(task.id)] ?? "",
  );
  const updateComposerDraft = useNoteDraftStore((s) => s.setDraft);
  const clearComposerDraftIf = useNoteDraftStore((s) => s.clearDraftIf);
  const deleteTasks = useTaskDeletion();

  // Available move destinations (other open task list tabs).
  const moveDestinations = workspace.openTabs.filter(
    (t) => !t.isUnifiedView && t.filePath !== filePath,
  );

  // Sync drafts when task changes (different task selected).
  const currentTaskKey = taskSelectionKey(task);
  const [lastTaskKey, setLastTaskKey] = useState(currentTaskKey);
  if (currentTaskKey !== lastTaskKey) {
    setLastTaskKey(currentTaskKey);
    setTitleDraft(task.title);
    setDescDraft(task.description);
  }

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusNewNoteSignalRef = useRef(focusNewNoteSignal);
  const titleComposing = useComposing();
  const noteComposing = useComposing();
  const autoGrowTitle = useAutoGrow(titleRef);
  const autoGrowDesc = useAutoGrow(descRef);
  const autoGrowNewNote = useAutoGrow(newNoteRef);

  const showWriteFailure = async (title: string, result: ActionResult) => {
    if (result.status === "error") {
      await showMessage(title, result.message);
      return true;
    }
    return false;
  };

  // Sync drafts when the same task is updated externally (e.g. renamed in the left pane).
  // Skip if the field is focused — the user is actively editing.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) {
      setTitleDraft(task.title);
    }
  }, [task.title]);

  useEffect(() => {
    if (document.activeElement !== descRef.current) {
      setDescDraft(task.description);
    }
  }, [task.description]);

  // Re-measure after external sync or content change.
  useEffect(() => autoGrowTitle(), [titleDraft, autoGrowTitle]);
  useEffect(() => autoGrowDesc(), [descDraft, autoGrowDesc]);
  useEffect(() => autoGrowNewNote(), [newNoteContent, autoGrowNewNote]);
  useEffect(() => {
    if (focusNewNoteSignal === lastFocusNewNoteSignalRef.current) return;
    lastFocusNewNoteSignalRef.current = focusNewNoteSignal;
    if (focusNewNoteSignal === 0) return;

    requestAnimationFrame(() => {
      const textarea = newNoteRef.current;
      if (!textarea) return;

      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      autoGrowNewNote();
    });
  }, [focusNewNoteSignal, autoGrowNewNote]);

  const handleTitleBlur = async () => {
    const cleaned = singleLine(titleDraft, { minify: true });
    if (!cleaned) {
      // Revert — don't allow empty titles.
      setTitleDraft(task.title);
      return;
    }
    if (cleaned !== task.title) {
      const result = await updateTitle(filePath, task.id, cleaned);
      if (await showWriteFailure("Task Update Failed", result)) {
        setTitleDraft(task.title);
        return;
      }
    }
    setTitleDraft(cleaned);
  };

  const handleDescBlur = async () => {
    const cleaned = multiline(descDraft);
    if (cleaned !== task.description) {
      const result = await updateDescription(filePath, task.id, cleaned);
      if (await showWriteFailure("Task Update Failed", result)) {
        setDescDraft(task.description);
        return;
      }
    }
    setDescDraft(cleaned);
  };

  const handleStatusChange = async (status: TaskStatus) => {
    const result = await setStatusAction(filePath, task.id, status);
    if (result.status === "validation") {
      await showMessage("Task Update Failed", result.reason);
      return;
    }
    if (result.status === "error") {
      await showMessage("Task Update Failed", result.message);
      return;
    }

    // Pointer rule: advance only when the change moves the task out of the
    // active list. The keyboard advances after every change instead — see
    // statusAdvancesSelection for why the two differ.
    if (statusAdvancesSelection(status)) {
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
  };

  const handlePriorityChange = async (priority: TaskPriority) => {
    const result = await setPriority(filePath, task.id, priority);
    await showWriteFailure("Task Update Failed", result);
  };

  const handleDueDateChange = async (value: string) => {
    const result = await setDueDate(filePath, task.id, value || null);
    await showWriteFailure("Task Update Failed", result);
  };

  const handleDeleteTask = async () => {
    await deleteTasks([task], nextActiveTaskKey);
  };

  const handleAddNote = async (
    actionability: NoteActionability = "Informational",
  ) => {
    const cleaned = multiline(newNoteContent);
    if (!cleaned) return;
    const result = await addNewNote(
      filePath,
      task.id,
      cleaned,
      actionability,
    );
    if (await showWriteFailure("Note Update Failed", result)) return;
    clearComposerDraftIf(composerDraftKey(task.id), newNoteContent);
  };

  const handleMoveTask = async () => {
    if (!moveTarget) return;
    const ids = new Set([task.id]);
    const result = await moveTasks(filePath, moveTarget, ids);
    if (result.status === "error") {
      await showMessage("Move Failed", result.message);
      return;
    }
    if (isUnifiedView) {
      setSelection(new Set([taskKey(moveTarget, task.id)]));
    } else {
      setSelection(nextActiveTaskKey ? new Set([nextActiveTaskKey]) : new Set());
    }
    setMoveTarget("");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pt-4">
      {/* Title */}
      <textarea
        ref={titleRef}
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={handleTitleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (isComposingKeyboardEvent(titleComposing.composingRef, e)) return;
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        {...titleComposing.handlers}
        placeholder="Task title..."
        rows={1}
        className="mb-4 w-full shrink-0 resize-none text-lg font-semibold text-ink-strong outline-none placeholder:text-ink-muted"
      />

      {/* Status, Priority, Due Date row */}
      <div className="mb-4 flex flex-wrap gap-3">
        {/* Status */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Status</label>
          <select
            value={task.status}
            onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
            className="rounded-md border border-border px-2 py-1 text-sm text-ink"
          >
            <option value="Pending">Pending</option>
            <option value="Completed" disabled={!task.canComplete}>
              Completed {!task.canComplete ? "(actionable notes)" : ""}
            </option>
            <option value="Dismissed">Dismissed</option>
          </select>
        </div>

        {/* Priority */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Priority</label>
          <select
            value={task.priority}
            onChange={(e) => handlePriorityChange(e.target.value as TaskPriority)}
            className={`rounded-md border px-2 py-1 text-sm ${prioritySelectStyle(task.priority)}`}
          >
            <option value="Critical">Critical</option>
            <option value="Important">Important</option>
            <option value="Urgent">Urgent</option>
            <option value="Default">Default</option>
          </select>
        </div>

        {/* Due Date */}
        <div>
          <label className="mb-1 block text-xs text-ink-muted">Due</label>
          <DatePicker
            value={task.dueDate}
            onChange={(v) => handleDueDateChange(v ?? "")}
            isOverdue={task.isOverdue}
          />
        </div>
      </div>

      {/* Reorder buttons */}
      <Toolbar
        label="Task actions"
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        {!isUnifiedView && (
          <>
            <button
              onClick={async () => {
                const result = await sendToFirst(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
            >
              Tackle
            </button>
            {kickDistances.map((d) => (
              <button
                key={d}
                onClick={async () => {
                  const result = await kick(filePath, d);
                  await showWriteFailure("Task Reorder Failed", result);
                }}
                className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
              >
                +{d}
              </button>
            ))}
            <button
              onClick={async () => {
                const result = await sendToLast(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-border px-2 py-1 text-xs text-ink-soft hover:bg-background"
            >
              Kick
            </button>
            <button
              onClick={async () => {
                const result = await dropkick(filePath);
                await showWriteFailure("Task Reorder Failed", result);
              }}
              className="rounded border border-danger-border px-2 py-1 text-xs text-danger hover:bg-danger-surface"
            >
              Dropkick
            </button>
            <span className="mx-1 text-border">|</span>
          </>
        )}
        <button
          onClick={handleDeleteTask}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-ink-soft hover:border-danger-border hover:text-danger"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </Toolbar>

      {/* Move to another list */}
      {moveDestinations.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-xs text-ink-muted">Move to</label>
          <select
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
            className="flex-1 rounded-md border border-border px-2 py-1 text-sm text-ink-soft"
          >
            <option value="">Select destination...</option>
            {moveDestinations.map((t) => (
              <option key={t.filePath} value={t.filePath}>
                {t.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={handleMoveTask}
            disabled={!moveTarget}
            className="rounded-md bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
          >
            Move
          </button>
        </div>
      )}

      {/* Description */}
      <div className="mb-4">
        <label className="mb-1 block text-xs text-ink-muted">Description</label>
        <textarea
          ref={descRef}
          value={descDraft}
          onChange={(e) => {
            setDescDraft(e.target.value);
            autoGrowDesc();
          }}
          onBlur={handleDescBlur}
          rows={2}
          placeholder="Add a description..."
          className="w-full resize-none rounded-md border border-border p-2 text-sm text-ink outline-none focus:border-primary-ring"
        />
      </div>

      {/* Timestamps */}
      <div className="mb-4 space-y-0.5 text-xs text-ink-muted">
        <div>
          Created:{" "}
          {formatTimestamp(task.createdAtUtc, preferences.timezone)}
        </div>
        <div>
          Updated:{" "}
          {formatTimestamp(task.updatedAtUtc, preferences.timezone)}
        </div>
        {task.completedAtUtc && (
          <div>
            Handled:{" "}
            {formatTimestamp(task.completedAtUtc, preferences.timezone)}
          </div>
        )}
        {task.dueDate && (
          <div>
            Due: {formatDueDate(task.dueDate)}
          </div>
        )}
      </div>

      {/* Notes section */}
      <div className="border-t border-border pt-4">
        <h4 className="mb-3 text-sm font-medium text-ink-soft">Notes</h4>

        {/* Add note */}
        <div className="mb-3">
          <textarea
            ref={newNoteRef}
            value={newNoteContent}
            onChange={(e) => {
              updateComposerDraft(composerDraftKey(task.id), e.target.value);
              autoGrowNewNote();
            }}
            onKeyDown={(e) => {
              // Same decider as the editor below, so the two cannot drift apart
              // again — they already had, which is the whole defect: this path
              // honoured Shift and the edit path quietly ignored it. Cmd+Enter is
              // the binding and stays live; the Ctrl half is Cocoa's
              // insertLineBreak: inside a text field, so the decider yields there
              // (keyboard-shortcut-conventions).
              const action = noteEditorAction(e);
              // "cancel" belongs to an open editor; a composer with nothing typed
              // has nothing to cancel, so Escape is left to the surrounding UI.
              if (action !== "save" && action !== "save-actionable") return;
              if (isComposingKeyboardEvent(noteComposing.composingRef, e)) return;
              e.preventDefault();
              handleAddNote(action === "save-actionable" ? "Actionable" : "Informational");
            }}
            {...noteComposing.handlers}
            placeholder={`Add a note... (${primaryModifierLabel}+Enter to save, ${primaryModifierLabel}+Shift+Enter actionable)`}
            rows={2}
            className="w-full resize-none rounded-md border border-border px-3 py-1.5 text-sm outline-none focus:border-primary-ring"
          />
          <div className="mt-1 flex justify-end">
            <button
              onClick={() => handleAddNote()}
              disabled={!newNoteContent.trim()}
              className="rounded-md bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
            >
              Add Note
            </button>
          </div>
        </div>

        {/* Notes list */}
        {task.notes.length === 0 ? (
          <div className="py-4 text-center text-sm text-ink-muted">
            No notes yet
          </div>
        ) : (
          <div className="space-y-2">
            {task.notes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                taskId={task.id}
                filePath={filePath}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom spacer — prevents margin collapse at the scroll boundary */}
      <div className="shrink-0 pb-4" />
    </div>
  );
}

function NoteItem({
  note,
  taskId,
  filePath,
}: {
  note: NoteDto;
  taskId: string;
  filePath: string;
}) {
  const preferences = usePreferencesStore((s) => s.preferences);
  const updateNote = useTaskListStore((s) => s.updateNote);
  const removeNote = useTaskListStore((s) => s.removeNote);
  const setActionability = useTaskListStore((s) => s.setNoteActionability);

  // The edit draft lives in the draft store; its presence IS the editing state,
  // so the two can never disagree and a parked edit survives this component
  // unmounting (the detail pane re-renders on every selection or task change)
  // and, because the store writes through to disk, quitting the app. Edit seeds
  // it, Save and Cancel clear it.
  const draftKey = editorDraftKey(taskId, note.id);
  const entry = useNoteDraftStore((s) => s.drafts[draftKey]);
  const setDraft = useNoteDraftStore((s) => s.setDraft);
  const openDraft = useNoteDraftStore((s) => s.openDraft);
  const clearDraft = useNoteDraftStore((s) => s.clearDraft);
  const clearDraftIf = useNoteDraftStore((s) => s.clearDraftIf);
  const justOpened = useNoteDraftStore((s) => s.justOpenedKey === draftKey);
  const clearJustOpened = useNoteDraftStore((s) => s.clearJustOpened);
  const editing = entry !== undefined;
  const draft = entry ?? "";
  const composing = useComposing();
  const editRef = useRef<HTMLTextAreaElement>(null);
  const autoGrowEdit = useAutoGrow(editRef);

  // Focus the editor the user just opened. Deliberately not `autoFocus`, which
  // fires on every mount: a parked draft keeps the editor open, and the detail
  // pane remounts on every task selection, so `autoFocus` stole the arrow keys
  // from the task list each time the user landed back on the task.
  useEffect(() => {
    if (!justOpened) return;
    editRef.current?.focus();
    clearJustOpened();
  }, [justOpened, clearJustOpened]);

  // Re-measure when draft changes or when entering edit mode.
  useEffect(() => {
    if (editing) autoGrowEdit();
  }, [draft, editing, autoGrowEdit]);

  // `actionability` is passed only by the Shift chord, which saves the text AND
  // flags the note in one keystroke — the pairing the composer above already
  // offers on add, and which edit silently dropped. Two separate writes back it,
  // so the flag is applied only once the text write has actually succeeded:
  // flagging a note whose edit failed would change what it claims while leaving
  // what it says stale.
  //
  // Deliberately asymmetric with the composer: a plain save here does NOT reset
  // the note to Informational the way adding one does. By edit time the note
  // carries an actionability the user may have picked from the dropdown, and
  // clearing that on an unrelated text save would be a new way to lose work.
  const handleSave = async (actionability?: NoteActionability) => {
    const cleaned = multiline(draft);
    if (!cleaned) {
      // Revert — don't allow empty notes.
      clearDraft(draftKey);
      return;
    }
    if (cleaned !== note.content) {
      const result = await updateNote(filePath, taskId, note.id, cleaned);
      if (result.status === "error") {
        // Keep the draft as typed so the user can retry or Cancel; a failed
        // write is no reason to discard their text.
        await showMessage("Note Update Failed", result.message);
        return;
      }
    }
    if (actionability && actionability !== note.actionability) {
      const result = await setActionability(filePath, taskId, note.id, actionability);
      if (result.status === "error") {
        // The text is already saved; leave the editor open so the failure is
        // visible against the note it failed on rather than closing over it.
        await showMessage("Note Update Failed", result.message);
        return;
      }
    }
    clearDraftIf(draftKey, draft);
  };

  // ESCAPE ONLY. The Cancel button below deliberately does NOT share this guard
  // (developer, 2026-08-20): clicking Cancel IS the decision to discard, and
  // asking again turns an explicit answer into a nag. Escape is the reflex —
  // hit on the way out of a field, or aimed at something else entirely — so it
  // is the one that must ask before a typed draft disappears.
  //
  // Compared after `multiline`, so whitespace that saving would strip anyway
  // does not count as a change worth interrupting the user over.
  const requestCancelViaEscape = useDirtyClose(
    editing && multiline(draft) !== note.content,
    () => clearDraft(draftKey),
  );

  const handleDeleteNote = async () => {
    const confirmed =
      !preferences.confirmPermanentDeletions ||
      (await showNoteDeletionConfirm());
    if (confirmed) {
      const result = await removeNote(filePath, taskId, note.id);
      if (result.status === "error") {
        await showMessage("Note Update Failed", result.message);
        return;
      }
      // The note is gone; a parked edit draft for it must not linger.
      clearDraft(draftKey);
    }
  };

  const handleActionabilityChange = async (actionability: NoteActionability) => {
    const result = await setActionability(filePath, taskId, note.id, actionability);
    if (result.status === "error") {
      await showMessage("Note Update Failed", result.message);
    }
  };

  const borderColor =
    note.actionability === "Actionable"
      ? "border-attention-border bg-attention-surface"
      : note.actionability === "Resolved"
        ? "border-success-border bg-success-surface/50"
        : "border-border";

  const icon =
    note.actionability === "Actionable" ? (
      <AlertCircle size={14} className="text-attention" />
    ) : note.actionability === "Resolved" ? (
      <CheckCircle size={14} className="text-success" />
    ) : (
      <Info size={14} className="text-ink-muted" />
    );

  return (
    <div className={`rounded-md border-l-4 border ${borderColor} p-3`}>
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <select
          value={note.actionability}
          onChange={(e) =>
            handleActionabilityChange(e.target.value as NoteActionability)
          }
          className="rounded border border-border px-1 py-0.5 text-xs text-ink"
        >
          <option value="Informational">Informational</option>
          <option value="Actionable">Actionable</option>
          <option value="Resolved">Resolved</option>
        </select>

        <span className="ml-auto text-xs text-ink-muted">
          {formatTimestamp(note.createdAtUtc, preferences.timezone)}
        </span>
        <button
          onClick={handleDeleteNote}
          className="rounded p-0.5 text-ink-muted hover:text-danger"
          title="Delete note"
        >
          <X size={14} />
        </button>
      </div>

      {editing ? (
        <div>
          <textarea
            ref={editRef}
            value={draft}
            onChange={(e) => {
              setDraft(draftKey, e.target.value);
              autoGrowEdit();
            }}
            onKeyDown={(e) => {
              const action = noteEditorAction(e);
              if (!action) return;
              // After the chord matches, never before: Escape and Enter both mean
              // something else mid-composition (cancel the conversion, commit it),
              // so a half-typed Japanese word must not close or save the editor.
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              if (action === "cancel") void requestCancelViaEscape();
              else void handleSave(action === "save-actionable" ? "Actionable" : undefined);
            }}
            {...composing.handlers}
            rows={2}
            className="w-full resize-none rounded border border-border p-2 text-sm outline-none focus:border-primary-ring"
          />
          <div className="mt-1 flex gap-2">
            <button
              // Wrapped, not passed directly: `handleSave` now takes an optional
              // actionability, and a bare handler reference would hand it the
              // click event — truthy, so every mouse Save would try to write a
              // MouseEvent as the note's actionability.
              onClick={() => void handleSave()}
              disabled={!draft.trim()}
              className="rounded bg-primary-solid px-3 py-1 text-xs text-ink-inverted hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
            >
              Save
            </button>
            <button
              // Immediate, unguarded discard — see requestCancelViaEscape above.
              onClick={() => clearDraft(draftKey)}
              className="rounded border border-border px-3 py-1 text-xs text-ink-muted hover:bg-background"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => openDraft(draftKey, note.content)}
          className="cursor-pointer text-sm text-ink"
        >
          <p className="whitespace-pre-wrap break-words">{note.content}</p>
        </div>
      )}
    </div>
  );
}

function prioritySelectStyle(priority: string): string {
  switch (priority) {
    case "Critical":
      return "border-group-critical-border-strong text-group-critical-fg";
    case "Urgent":
      return "border-group-urgent-border-strong text-group-urgent-fg";
    case "Important":
      return "border-group-important-border-strong text-group-important-fg";
    default:
      return "border-border text-ink";
  }
}
