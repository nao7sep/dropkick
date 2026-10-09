// Left pane — displays tasks grouped by priority/due rules.
// Supports selection (click, Shift+click, Cmd+click on macOS / Ctrl+click on Windows).

import { useState, useRef, useMemo, useEffect } from "react";
import { Plus, AlertCircle, Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { Task, TaskGroup } from "../../models";
import { useTaskListStore } from "../../state/task-list-store";
import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import {
  singleLine,
  hasPointerCommandModifier,
  primaryModifierLabel,
  taskSelectionKey,
  rowDomId,
  stepIndex,
  pageStepIndex,
  rangeKeysBetween,
  planRangeSelection,
  planListArrowDown,
  type ListArrowDownPlan,
} from "../../utils";
import {
  summarizeUnifiedLoadState,
  taskListEmptyMessage,
} from "../../services";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useViewTasks } from "../../hooks/useViewTasks";
import { describeDiskFailure, describeLoadFailure, fieldDraftKey, fileNameWithoutExt } from "../../services";
import { useNoteDraftStore } from "../../state/note-draft-store";
import { Button } from "../shared/Button";
import { useI18n } from "../../i18n/I18nContext";
import type { Message } from "../../i18n/translate";

interface TaskListPaneProps {
  filePath: string;
  isUnifiedView: boolean;
  onNewTask: () => void;
}

// Each group is a rounded card in its own tint and edge, titled in its colour
// with a dot and a count, holding its tasks as rounded rows on the surface. The
// colour lives in the card, the dot and the badge; there is no stripe for the
// rounding to bend or split (interface-styling-conventions, "Rounding never
// reshapes a marker"). `--g-accent` feeds the dot and the rows' hover step;
// `--g-fg` the title and the badge; `--g-tint` the card, which the rows sit on.
const GROUP_CARDS: Record<TaskGroup, string> = {
  PastDue:
    "border-group-pastdue-border bg-group-pastdue-tint text-group-pastdue-fg [--g-accent:var(--group-pastdue-accent)] [--g-fg:var(--group-pastdue-fg)] [--g-tint:var(--group-pastdue-tint)]",
  Critical:
    "border-group-critical-border bg-group-critical-tint text-group-critical-fg [--g-accent:var(--group-critical-accent)] [--g-fg:var(--group-critical-fg)] [--g-tint:var(--group-critical-tint)]",
  DueToday:
    "border-group-duetoday-border bg-group-duetoday-tint text-group-duetoday-fg [--g-accent:var(--group-duetoday-accent)] [--g-fg:var(--group-duetoday-fg)] [--g-tint:var(--group-duetoday-tint)]",
  Important:
    "border-group-important-border bg-group-important-tint text-group-important-fg [--g-accent:var(--group-important-accent)] [--g-fg:var(--group-important-fg)] [--g-tint:var(--group-important-tint)]",
  Urgent:
    "border-group-urgent-border bg-group-urgent-tint text-group-urgent-fg [--g-accent:var(--group-urgent-accent)] [--g-fg:var(--group-urgent-fg)] [--g-tint:var(--group-urgent-tint)]",
  DueSoon:
    "border-group-duesoon-border bg-group-duesoon-tint text-group-duesoon-fg [--g-accent:var(--group-duesoon-accent)] [--g-fg:var(--group-duesoon-fg)] [--g-tint:var(--group-duesoon-tint)]",
  Default:
    "border-border bg-surface-sunken text-ink-soft [--g-accent:var(--ink-faint)] [--g-fg:var(--ink-soft)] [--g-tint:var(--surface-sunken)]",
};

// Cards carry no outer margin: the listbox spaces them with one gap and pads
// its ends by the same amount, so every pair of adjacent groups — the handled
// archive and whatever comes last included — sits the same distance apart,
// scrolled or not.
// Inside, the card is one even frame judged by the text, since rows have no
// fill: border to title, title to first task and last task to border are
// the same (about 16px). The bottom padding (6px) matches the rows' side inset,
// so a hovered or selected last row's fill sits the same distance from the
// card's edge on every side.
const CARD_CLASS = "rounded-[var(--radius-card)] border pb-1.5";

// Rows moved per PageUp/PageDown press. A fixed step rather than a measured
// viewport — predictable, and the list rarely needs pixel-accurate paging.
const LIST_PAGE = 10;


export function TaskListPane({ filePath, isUnifiedView, onNewTask }: TaskListPaneProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const pageSize = usePreferencesStore((s) => s.preferences.handledTasksPageSize);
  const selectedKeys = useTaskListStore((s) => s.selectedKeys);
  const setSelection = useTaskListStore((s) => s.setSelection);
  const reorderTick = useTaskListStore((s) => s.reorderTick);
  const updateTitle = useTaskListStore((s) => s.updateTitle);
  const showMoreHandled = useTaskListStore((s) => s.showMoreHandled);
  const setHandledExpanded = useTaskListStore((s) => s.setHandledExpanded);
  const fileLoadError = useTaskListStore((s) => s.fileLoadErrors[filePath]);
  const fileDiskError = useTaskListStore((s) => s.fileDiskErrors[filePath]);
  const unsavedFiles = useTaskListStore((s) => s.unsavedFiles);
  const retryUnsaved = useTaskListStore((s) => s.retryUnsaved);
  const fileLoadErrors = useTaskListStore((s) => s.fileLoadErrors);
  const loadFile = useTaskListStore((s) => s.loadFile);
  const activeTabIndex = useWorkspaceStore((s) => s.workspace.activeTabIndex);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const viewKey = isUnifiedView ? "__unified__" : filePath;
  const handledVisible = useTaskListStore(
    (s) => s.handledVisible[viewKey] ?? pageSize,
  );
  const handledExpanded = useTaskListStore(
    (s) => s.handledExpanded[viewKey] ?? false,
  );

  const files = useTaskListStore((s) => s.files);
  const openTabs = useWorkspaceStore((s) => s.workspace.openTabs);

  const { grouped } = useViewTasks(filePath, isUnifiedView);

  // In unified view, the merged list silently omits any open list whose file
  // isn't loaded — whether it failed or is still loading. Summarize both so the
  // pane can show the roll-up is incomplete rather than passing a partial merge
  // off as the whole picture. Cheap and skipped entirely outside unified view.
  const unifiedLoad = useMemo(() => {
    if (!isUnifiedView) return { failedNames: [], loadingCount: 0 };
    return summarizeUnifiedLoadState(
      openTabs,
      new Set(Object.keys(files)),
      new Set(Object.keys(fileLoadErrors)),
    );
  }, [isUnifiedView, openTabs, files, fileLoadErrors]);
  const unsavedNames = useMemo(
    () =>
      isUnifiedView
        ? openTabs
            .filter((tab) => !tab.isUnifiedView && unsavedFiles[tab.filePath] !== undefined)
            .map((tab) => tab.displayName)
        : [],
    [isUnifiedView, openTabs, unsavedFiles],
  );
  const visibleHandled = grouped.handled.slice(0, handledVisible);
  const emptyMessage = taskListEmptyMessage(grouped, handledExpanded);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // The listbox container is the single tab stop; DOM focus lives here while the
  // list is active, so a row unmounting (e.g. a completed task collapsing into
  // Handled) never drops focus to <body>. anchorRef pins one end of a keyboard
  // range selection.
  const listRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<string | null>(null);
  const dominantSelectedKey = useMemo(() => {
    const keys = [...selectedKeys];
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }, [selectedKeys]);

  // Active-task keys and visible-handled keys in visual order, kept separate so
  // the "expand into Handled" path can build the post-expand domain before the
  // expansion has re-rendered.
  const activeKeys = useMemo(
    () => grouped.groups.flatMap((g) => g.tasks).map(taskSelectionKey),
    [grouped],
  );
  const handledKeys = useMemo(
    () => grouped.handled.slice(0, handledVisible).map(taskSelectionKey),
    [grouped, handledVisible],
  );
  // The keyboard navigation domain in visual order: active tasks, plus the
  // visible handled tasks when the Handled archive is expanded, so arrowing
  // flows continuously from the active list into Handled and back.
  const visualKeys = useMemo(
    () => (handledExpanded ? [...activeKeys, ...handledKeys] : activeKeys),
    [activeKeys, handledKeys, handledExpanded],
  );
  const activeDescendantId = dominantSelectedKey
    ? rowDomId(dominantSelectedKey)
    : undefined;

  // Scroll the dominant selected row into view when the selection changes, or
  // when a reorder (kick/tackle/move up/down) shifts the still-selected task
  // (signalled by reorderTick). Deliberately NOT keyed on `tasks`: doing so
  // would also fire during the intermediate render of an advance action
  // (status/priority/due/dropkick), where tasks have already changed but the
  // selection hasn't advanced yet — scrolling to the stale, about-to-leave row
  // and causing a visible jump.
  useEffect(() => {
    if (!dominantSelectedKey) return;
    const row = rowRefs.current.get(dominantSelectedKey);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
  }, [dominantSelectedKey, reorderTick]);

  const registerRowRef = (selectionKey: string) => (node: HTMLDivElement | null) => {
    if (node) {
      rowRefs.current.set(selectionKey, node);
    } else {
      rowRefs.current.delete(selectionKey);
    }
  };

  const handleTaskClick = (task: Task, e: React.MouseEvent) => {
    const clickedKey = taskSelectionKey(task);

    if (e.shiftKey) {
      // Range select over the same domain the keyboard uses (active tasks, plus
      // Handled when the archive is expanded), from the same anchor and by the
      // same rule — see planRangeSelection.
      const range = planRangeSelection(
        visualKeys,
        anchorRef.current,
        selectedKeys,
        clickedKey,
      );
      if (range) {
        setSelection(range);
        return;
      }
    }

    // Pointer chord: the command flags alone, no Alt exclusion — AltGr types
    // characters, which has no meaning for a click, and Cmd+Alt+Click must
    // keep toggling (keyboard-shortcut-conventions).
    if (hasPointerCommandModifier(e)) {
      // Toggle single.
      const next = new Set(selectedKeys);
      if (next.has(clickedKey)) {
        next.delete(clickedKey);
      } else {
        next.add(clickedKey);
      }
      anchorRef.current = clickedKey;
      setSelection(next);
      return;
    }

    // Simple click — select only this one.
    anchorRef.current = clickedKey;
    setSelection(new Set([clickedKey]));
  };

  const [editingTaskKey, setEditingTaskKey] = useState<string | null>(null);
  const [renameErrors, setRenameErrors] = useState<Record<string, Message>>({});

  // Keyboard-first: focus the list on tab load so arrows work without a click,
  // but only when nothing else holds focus — never steal from an input or a tab
  // the user is already on.
  useEffect(() => {
    if (document.activeElement === document.body) {
      listRef.current?.focus();
    }
  }, []);

  const focusList = () => {
    requestAnimationFrame(() => listRef.current?.focus());
  };

  // Listbox navigation — active only while the list has focus. Command keys
  // (status/priority/due/dropkick/dismiss/reorder) are intentionally NOT handled
  // here: they fall through to the global command layer, which skips whatever
  // this handler consumes via preventDefault. Arrowing down past the last visible
  // item reaches into the Handled archive: it expands on first entry and loads the
  // next page as the cursor reaches the end, so Up/Down flow continuously through
  // active tasks and Handled without the disclosure or "show more" ever being a
  // focusable tab stop.
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || editingTaskKey !== null) return;
    // Cmd/Ctrl/Alt combos (reorder, tackle/kick, tab switch) are the global
    // command layer's; let them bubble untouched.
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const len = visualKeys.length;
    const currentIdx = dominantSelectedKey
      ? visualKeys.indexOf(dominantSelectedKey)
      : -1;

    const selectKey = (key: string) => {
      anchorRef.current = key;
      setSelection(new Set([key]));
    };
    const selectIdx = (idx: number) => selectKey(visualKeys[idx]);
    const extendTo = (idx: number) => {
      let anchorIdx = anchorRef.current
        ? visualKeys.indexOf(anchorRef.current)
        : currentIdx;
      if (anchorIdx < 0) anchorIdx = idx;
      setSelection(new Set(rangeKeysBetween(visualKeys, anchorIdx, idx)));
    };
    // Execute an ArrowDown plan (move within the range, or cross the boundary
    // into the Handled archive). Shared by ArrowDown and the empty-list End case.
    const applyDownPlan = (plan: ListArrowDownPlan) => {
      switch (plan.kind) {
        case "select":
          if (e.shiftKey) extendTo(plan.index);
          else selectIdx(plan.index);
          break;
        case "expandHandled": {
          setHandledExpanded(viewKey, true);
          const first = grouped.handled[0];
          if (!first) break;
          const firstKey = taskSelectionKey(first);
          // Shift+Down across the boundary must extend the range into Handled,
          // not collapse the selection to one task. visualKeys hasn't picked up
          // the just-toggled expansion yet, so range over the explicit
          // post-expand domain.
          if (e.shiftKey) {
            const postExpand = [...activeKeys, ...handledKeys];
            const anchorIdx = anchorRef.current
              ? postExpand.indexOf(anchorRef.current)
              : -1;
            const targetIdx = postExpand.indexOf(firstKey);
            if (anchorIdx >= 0 && targetIdx >= 0) {
              setSelection(new Set(rangeKeysBetween(postExpand, anchorIdx, targetIdx)));
              break;
            }
          }
          selectKey(firstKey);
          break;
        }
        case "showMoreHandled":
          showMoreHandled(viewKey, pageSize);
          break;
        case "none":
          break;
      }
    };
    const downPlan = (cursor: number): ListArrowDownPlan =>
      planListArrowDown({
        currentIndex: cursor,
        length: len,
        handledExpanded,
        handledTotal: grouped.handledTotal,
        handledVisible,
      });

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        applyDownPlan(downPlan(currentIdx));
        return;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (len === 0) return;
        const target =
          currentIdx === -1 ? len - 1 : stepIndex(currentIdx, -1, len);
        if (e.shiftKey) extendTo(target);
        else selectIdx(target);
        return;
      }
      case "Home": {
        e.preventDefault();
        if (len === 0) return;
        if (e.shiftKey) extendTo(0);
        else selectIdx(0);
        return;
      }
      case "End": {
        e.preventDefault();
        if (len === 0) {
          applyDownPlan(downPlan(-1));
          return;
        }
        const last = len - 1;
        if (e.shiftKey) extendTo(last);
        else selectIdx(last);
        return;
      }
      case "PageDown":
      case "PageUp": {
        e.preventDefault();
        if (len === 0) return;
        const dir = e.key === "PageDown" ? 1 : -1;
        const target =
          currentIdx === -1
            ? dir === 1
              ? 0
              : len - 1
            : pageStepIndex(currentIdx, dir, LIST_PAGE, len);
        if (e.shiftKey) extendTo(target);
        else selectIdx(target);
        return;
      }
      default:
        return;
    }
  };

  if (!isUnifiedView && fileLoadError) {
    return (
      <LoadErrorPane
        filePath={filePath}
        message={describeLoadFailure("taskList", fileLoadError)}
        onRetry={() => loadFile(filePath)}
        onRemove={() => closeTab(activeTabIndex)}
      />
    );
  }

  // The typed title is a draft in the draft store, under the same key the
  // detail pane's title field uses, so a quit that never blurs the input still
  // commits it (hooks/use-window-close). Success or Reload clears only the
  // submitted generation; later typing keeps its draft and editor. A failed
  // write keeps the input open for retry.
  const handleRename = async (task: Task, newTitle: string) => {
    const selectionKey = taskSelectionKey(task);
    const draftKey = fieldDraftKey(task.id, "title");
    const version = useNoteDraftStore.getState().draftVersions[draftKey];
    const cleaned = singleLine(newTitle, { minify: true });
    if (!cleaned) {
      // Don't allow empty titles — just cancel the rename.
      const cleared = useNoteDraftStore.getState().clearDraftIf(draftKey, newTitle, version);
      if (cleared) {
        setEditingTaskKey(null);
      }
      setRenameErrors((errors) => {
        const { [selectionKey]: _removed, ...rest } = errors;
        return rest;
      });
      if (cleared) focusList();
      return cleared;
    }
    if (cleaned !== task.title) {
      const result = await updateTitle(task.sourceFile, task.id, cleaned);
      if (result.status === "error") {
        setRenameErrors((errors) => ({
          ...errors,
          [selectionKey]: result.message,
        }));
        return false;
      }
      if (result.status === "reloaded") {
        const cleared = useNoteDraftStore.getState().clearDraftIf(draftKey, newTitle, version);
        if (cleared) {
          setEditingTaskKey(null);
        }
        setRenameErrors((errors) => ({
          ...errors,
          [selectionKey]: result.message,
        }));
        if (cleared) focusList();
        return cleared;
      }
    }
    const cleared = useNoteDraftStore.getState().clearDraftIf(draftKey, newTitle, version);
    if (cleared) {
      setEditingTaskKey(null);
    }
    setRenameErrors((errors) => {
      const { [selectionKey]: _removed, ...rest } = errors;
      return rest;
    });
    if (cleared) focusList();
    return cleared;
  };

  const cancelRename = (task: Task) => {
    useNoteDraftStore.getState().clearDraft(fieldDraftKey(task.id, "title"));
    setEditingTaskKey(null);
    focusList();
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* New task button — fixed header; stays visible while the list scrolls. */}
      <button
        onClick={onNewTask}
        className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 text-xs font-medium text-primary transition-colors duration-[var(--motion)] hover:bg-primary-surface active:bg-primary-surface-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-ring"
      >
        <Plus size={14} className="shrink-0" />
        <span className="min-w-0 truncate whitespace-nowrap">{t("newTask.title")}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap text-primary">
          {`${primaryModifierLabel}+N`}
        </span>
      </button>

      {/* The file changed on disk and could not be read back: say so above
          the copy still loaded, until the file reads back or is saved. */}
      {!isUnifiedView && fileDiskError && (
        <div
          role="alert"
          className="flex shrink-0 items-start border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong"
        >
          <span>{i18n.text(describeDiskFailure(fileDiskError))}</span>
        </div>
      )}

      {/* A failed save keeps the edit: say so above the list until a save of
          it lands, with the Retry that makes it. The unified view names every
          open list that is unsaved. */}
      {!isUnifiedView && unsavedFiles[filePath] && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-3 border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{i18n.text(unsavedFiles[filePath])}</span>
          <Button size="sm" onClick={() => retryUnsaved([filePath])}>
            {t("taskList.retry")}
          </Button>
        </div>
      )}
      {isUnifiedView && unsavedNames.length > 0 && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-3 border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong"
        >
          <span className="min-w-0 flex-1">
            {unsavedNames.length === 1
              ? t("unified.oneNotSaved", { name: unsavedNames[0] })
              : t("unified.manyNotSaved", {
                  count: unsavedNames.length,
                  names: i18n.list(unsavedNames),
                })}
          </span>
          <Button size="sm" onClick={() => retryUnsaved()}>
            {t("taskList.retry")}
          </Button>
        </div>
      )}

      {/* Unified view: warn about lists missing from the roll-up because their
          file failed to load, so an incomplete merge is never presented as the
          whole picture. Each affected list's own tab also shows a red icon and a
          retry pane when opened. */}
      {isUnifiedView && unifiedLoad.failedNames.length > 0 && (
        <div className="flex shrink-0 items-start border-b border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-fg-strong">
          <span>
            {unifiedLoad.failedNames.length === 1
              ? t("unified.oneFailed", { name: unifiedLoad.failedNames[0] })
              : t("unified.manyFailed", {
                  count: unifiedLoad.failedNames.length,
                  names: i18n.list(unifiedLoad.failedNames),
                })}
          </span>
        </div>
      )}

      {/* Unified view: a neutral notice while constituent lists are still
          loading, so the merge isn't briefly read as complete during the
          initial eager load. Disappears once every list is loaded or errored. */}
      {isUnifiedView && unifiedLoad.loadingCount > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-ink-muted">
          <span>
            {t("unified.loading", { count: unifiedLoad.loadingCount })}
          </span>
        </div>
      )}

      {/* Scrollable region holding the one composite listbox. Group headers and
          the Handled disclosure stick to the top of this area as the list scrolls,
          just below the fixed New Task button. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-pt-[36px]">
        {/* The composite listbox: one tab stop spanning the active tasks and the
            Handled archive. Navigation is handled here and fires only while the
            list has focus. The Handled disclosure and "show more" are inside it as
            non-focusable click targets — never tab stops — and the keyboard reaches
            Handled by arrowing past the last active task (see handleListKeyDown).
            Flex-1 so the Handled archive's mt-auto sits at the bottom and the empty
            state centers. It draws no ring of its own: the active row shows the
            cursor, and a ring here would outline the whole pane on the first key
            after a click (composite-control-conventions). */}
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable={true}
          aria-label={t("taskList.label")}
          aria-activedescendant={activeDescendantId}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="group flex flex-1 flex-col gap-2 p-2 focus:outline-none"
        >
          {/* Hidden handled rows do not fill the mandatory list body. Keep its
              folded archive available below while saying the active list is empty. */}
          {emptyMessage && (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-muted">
              {t(emptyMessage)}
            </div>
          )}

          {grouped.groups.map(({ group, label, tasks: groupTasks }) => (
            <div key={group} data-group={group} className={`${CARD_CLASS} ${GROUP_CARDS[group]}`}>
              {/* Sticks to the top of the scroll area within its own card, in the
                  card's tint so rows pass cleanly beneath it. */}
              <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-[var(--radius-card)] bg-inherit px-3 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-wide">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[var(--g-accent)]" />
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{t(label)}</span>
                <span className="shrink-0 rounded-full bg-[var(--g-fg)] px-1.5 text-[11px] font-semibold leading-[18px] tracking-normal text-surface tabular-nums">
                  {i18n.number(groupTasks.length)}
                </span>
              </div>
              {groupTasks.map((task) => {
                const selectionKey = taskSelectionKey(task);
                return (
                  <TaskRow
                    key={selectionKey}
                    rowRef={registerRowRef(selectionKey)}
                    asOption
                    domId={rowDomId(selectionKey)}
                    task={task}
                    isSelected={selectedKeys.has(selectionKey)}
                    isActive={selectionKey === dominantSelectedKey}
                    isEditing={editingTaskKey === selectionKey}
                    isUnifiedView={isUnifiedView}
                    sourceLabel={
                      isUnifiedView ? tabDisplayName(task.sourceFile, openTabs) : undefined
                    }
                    renameError={renameErrors[selectionKey]}
                    onClick={(e) => handleTaskClick(task, e)}
                    onDoubleClick={() => setEditingTaskKey(selectionKey)}
                    onRename={(title) => handleRename(task, title)}
                    onCancelRename={() => cancelRename(task)}
                  />
                );
              })}
            </div>
          ))}

          {/* Handled archive — part of the listbox so arrow navigation flows into
              it. The disclosure and "show more" are non-focusable click targets
              (mouse toggles/loads; keyboard reaches Handled by arrowing in), so the
              listbox stays a single tab stop. */}
          {grouped.handledTotal > 0 && (
            <div className={`mt-auto ${CARD_CLASS} ${GROUP_CARDS.Default} ${handledExpanded ? "" : "pb-0"}`}>
              <div
                onClick={() => setHandledExpanded(viewKey, !handledExpanded)}
                className="flex w-full cursor-pointer select-none items-center gap-2 rounded-[var(--radius-card)] px-3 py-2 text-xs font-medium text-ink-muted transition-colors duration-[var(--motion)] hover:bg-control-hover hover:text-ink active:bg-control-pressed"
              >
                <span className="flex items-center">
                  {handledExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span>{t("taskList.handled", { count: grouped.handledTotal })}</span>
              </div>

              {handledExpanded && (
                <>
                  {visibleHandled.map((task) => {
                    const selectionKey = taskSelectionKey(task);
                    return (
                      <TaskRow
                        key={selectionKey}
                        rowRef={registerRowRef(selectionKey)}
                        asOption
                        domId={rowDomId(selectionKey)}
                        task={task}
                        isSelected={selectedKeys.has(selectionKey)}
                        isActive={selectionKey === dominantSelectedKey}
                        isEditing={editingTaskKey === selectionKey}
                        isUnifiedView={isUnifiedView}
                        sourceLabel={
                          isUnifiedView ? tabDisplayName(task.sourceFile, openTabs) : undefined
                        }
                        renameError={renameErrors[selectionKey]}
                        onClick={(e) => handleTaskClick(task, e)}
                        onDoubleClick={() => setEditingTaskKey(selectionKey)}
                        onRename={(title) => handleRename(task, title)}
                        onCancelRename={() => cancelRename(task)}
                      />
                    );
                  })}
                  {handledVisible < grouped.handledTotal && (
                    <div
                      onClick={() => showMoreHandled(viewKey, pageSize)}
                      className="mx-1.5 cursor-pointer select-none rounded-[var(--radius-sm)] py-1.5 text-center text-xs text-primary transition-colors duration-[var(--motion)] hover:bg-primary-surface active:bg-primary-surface-strong"
                    >
                      {t("taskList.showMore", { count: grouped.handledTotal - handledVisible })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Individual task row in the list. Its left padding is trimmed (pl-1.5 against
// pr-3) because the stripe and the status slot's gap already sit on that side,
// so the text's room at both ends reads balanced.
function TaskRow({
  rowRef,
  asOption = false,
  domId,
  task,
  isSelected,
  isActive = false,
  isEditing,
  isUnifiedView,
  sourceLabel,
  renameError,
  onClick,
  onDoubleClick,
  onRename,
  onCancelRename,
}: {
  rowRef?: (node: HTMLDivElement | null) => void;
  // When true, the row is a listbox option. Both active rows and expanded
  // handled rows pass it: navigation runs continuously into the archive, and
  // aria-activedescendant points at handled rows once the cursor is inside it,
  // so they need the id/role/aria-selected this adds.
  asOption?: boolean;
  domId?: string;
  task: Task;
  isSelected: boolean;
  isActive?: boolean;
  isEditing: boolean;
  isUnifiedView: boolean;
  // Resolved source-list label, shown in unified view. Computed by the parent
  // from the subscribed open tabs so a tab rename updates the row immediately.
  sourceLabel?: string;
  renameError?: Message;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRename: (title: string) => Promise<boolean>;
  onCancelRename: () => void;
}) {
  const { t, text } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const draftKey = fieldDraftKey(task.id, "title");
  const draft = useNoteDraftStore((s) => s.drafts[draftKey]) ?? task.title;
  const setDraft = useNoteDraftStore((s) => s.setDraft);
  const composing = useComposing();

  const commitRename = async () => {
    const succeeded = await onRename(draft);
    if (!succeeded) inputRef.current?.focus();
  };

  // Focus when entering edit mode.
  useEffect(() => {
    if (isEditing) {
      // Defer focus so the input is mounted.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  return (
    <div
      ref={rowRef}
      id={asOption ? domId : undefined}
      role={asOption ? "option" : undefined}
      aria-selected={asOption ? isSelected : undefined}
      onClick={isEditing ? undefined : onClick}
      onDoubleClick={isEditing ? undefined : onDoubleClick}
      // A rounded row with no fill of its own, sitting on its group's card tint
      // and set apart from its neighbours by space. Hover steps the tint toward
      // the group colour; selection is the accent fill; the keyboard cursor,
      // while the keyboard drives the list, is a ring on the active row
      // (composite-control-conventions).
      className={`mx-1.5 mb-[5px] flex cursor-pointer last:mb-0 flex-wrap items-center gap-2 rounded-[var(--radius-sm)] py-2 pl-2 pr-3 text-ink transition-colors duration-[var(--motion)] ${
        isSelected
          ? "bg-primary-surface-strong"
          : "bg-transparent hover:bg-[color-mix(in_srgb,var(--g-tint),var(--g-accent)_18%)]"
      } ${
        asOption && isActive
          ? "group-focus-visible:ring-[1.5px] group-focus-visible:ring-inset group-focus-visible:ring-primary-ring"
          : ""
      }`}
    >
      {/* Status indicator */}
      <span className="shrink-0 text-xs">
        {task.status === "Completed" && (
          <Check size={14} className="text-success" />
        )}
        {task.status === "Dismissed" && (
          <X size={14} className="text-ink-muted" />
        )}
      </span>

      {/* Title — editable on double-click */}
      {isEditing ? (
        <input
          ref={inputRef}
          aria-invalid={renameError !== undefined}
          aria-describedby={renameError ? `rename-error-${task.id}` : undefined}
          value={draft}
          onChange={(e) => setDraft(draftKey, e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              void commitRename();
            }
            if (e.key === "Escape") {
              if (isComposingKeyboardEvent(composing.composingRef, e)) return;
              e.preventDefault();
              onCancelRename();
            }
          }}
          {...composing.handlers}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-primary-ring bg-surface px-1.5 py-0 text-sm text-ink outline-none"
        />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-sm ${
            task.status === "Dismissed" ? "line-through text-ink-muted" : ""
          } ${task.status === "Completed" ? "text-ink-soft" : ""}`}
        >
          {task.title || t("common.untitled")}
        </span>
      )}

      {/* Actionable notes indicator */}
      {task.hasActionableNotes && (
        <span title={t("taskList.hasActionable")}>
          <AlertCircle
            size={14}
            className="shrink-0 text-attention"
          />
        </span>
      )}

      {/* Source file label (unified view only) */}
      {isUnifiedView && (
        <span className="shrink-0 max-w-[30%] truncate text-xs text-ink-muted">
          {sourceLabel}
        </span>
      )}
      {renameError ? (
        <span
          id={`rename-error-${task.id}`}
          role="alert"
          className="w-full pl-6 text-xs text-danger"
        >
          {text(renameError)}
        </span>
      ) : null}
    </div>
  );
}

function LoadErrorPane({
  filePath,
  message,
  onRetry,
  onRemove,
}: {
  filePath: string;
  message: Message;
  onRetry: () => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const { t, text } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-danger-border bg-danger-surface p-5 text-sm">
        <div className="mb-3 font-semibold text-danger-fg-strong">
          {t("taskList.loadFailed")}
        </div>
        <p className="whitespace-pre-wrap text-danger-fg-strong">{text(message)}</p>
        <p className="mt-3 truncate text-xs text-danger" title={filePath}>
          {filePath}
        </p>
        <div className="mt-4 flex gap-2">
          {/* Retrying and closing the tab destroy nothing, so neither is red:
              the card says what went wrong, the buttons are ordinary roles. */}
          <Button variant="primary" onClick={onRetry}>
            {t("taskList.retry")}
          </Button>
          <Button onClick={onRemove}>{t("taskList.removeTab")}</Button>
        </div>
      </div>
    </div>
  );
}


/** Look up the tab's display name for a file path; fall back to raw filename.
 * Pure over the passed-in tabs (subscribed by the caller), so a tab rename
 * re-renders the affected rows instead of reading a stale getState() snapshot. */
function tabDisplayName(
  path: string,
  openTabs: readonly { filePath: string; displayName: string }[],
): string {
  const tab = openTabs.find((t) => t.filePath === path);
  if (tab) return tab.displayName;
  return fileNameWithoutExt(path);
}
