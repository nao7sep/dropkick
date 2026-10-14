// The workspace list: shown at first launch, when the last workspace cannot
// open, and from the main menu's Workspaces. A workspace is a file the
// user saves anywhere; it remembers which task lists are open, wherever those
// are. New creates an empty one, Add existing lists one already on disk,
// Rename edits the name stored in its file, and Remove only takes it off this
// list. The selection is local until a workspace opens; a switch can be
// cancelled, and first launch or recovery offers Quit.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FolderOpen, Pencil, Plus, X } from "lucide-react";
import {
  createWorkspaceFile,
  loadWorkspace,
  openJsonFileDialog,
  renameWorkspaceFile,
  saveJsonFileDialog,
  showMessage,
  log,
  toErrorFields,
} from "../../repositories";
import { useAppConfigStore } from "../../state/app-config-store";
import { useAppStateStore } from "../../state/app-state-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { describeLoadFailure, fileNameWithoutExt } from "../../services";
import { pageStepIndex, rowDomId, shortenPath, singleLine, stepIndex } from "../../utils";
import { useComposing, isComposingKeyboardEvent } from "../../hooks/useComposing";
import { useI18n } from "../../i18n/I18nContext";
import { AppModal } from "../shared/AppModal";
import { Button } from "../shared/Button";
import type { MessageKey } from "../../i18n/catalogues";
import { message } from "../../i18n/translate";

const STARTUP_LIST_PAGE = 4;
// Columns of 12px text a row's path keeps at the dialog's narrowest width.
const PATH_COLUMNS = 56;
const LIST_ID = "workspace";

interface StartupPickerProps {
  onLaunch: (workspacePath: string) => void | Promise<void>;
  onCancel?: () => void;
  onQuit?: () => void;
}

export function StartupPicker({ onLaunch, onCancel, onQuit }: StartupPickerProps) {
  const { t } = useI18n();
  const appState = useAppStateStore((s) => s.appState);
  const appConfig = useAppConfigStore((s) => s.appConfig);
  const register = useAppConfigStore((s) => s.register);
  const unregister = useAppConfigStore((s) => s.unregister);
  const items = appConfig.knownWorkspaces;

  const [selected, setSelected] = useState(
    items.includes(appState.lastWorkspacePath) ? appState.lastWorkspacePath : (items[0] ?? ""),
  );
  const [opening, setOpening] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renamingRef = useRef<string | null>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  // Each workspace shows the name stored in its file. A file that cannot be
  // read shows its file name; opening it reports why.
  const requestedNames = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    for (const path of items) {
      if (requestedNames.current.has(path)) continue;
      requestedNames.current.add(path);
      void loadWorkspace(path).then((loaded) => {
        if (mounted.current && loaded.status === "success") {
          setNames((current) => current[path] !== undefined ? current : { ...current, [path]: loaded.workspace.name });
        }
      }).catch((error) => log.warn("workspace name unavailable", { path, ...toErrorFields(error) }));
    }
  }, [items]);

  const nameOf = (path: string) => names[path] || fileNameWithoutExt(path);

  // Nothing here is a default action: a user may create a workspace, add one
  // they already have or open a listed one. With workspaces listed, focus
  // starts on the list, where arrows choose and Enter opens; with none, it
  // stays on the dialog surface so no button looks preselected. Done in
  // AppModal's onOpenAutoFocus because Radix's focus scope activates around
  // that callback, and focusing from an effect instead raced it and lost.
  const focusInitial = (e: Event) => {
    if (items.length === 0) return;
    e.preventDefault();
    listboxRef.current?.focus();
  };

  // Native pickers, document writes and saved-location writes report failures here.
  const guarded = async (
    action: "openWorkspace" | "createWorkspace" | "renameWorkspace",
    run: () => Promise<void>,
  ): Promise<void> => {
    try {
      await run();
    } catch (e) {
      log.error("workspace list action failed", { action, ...toErrorFields(e) });
      await showMessage(
        message(`startup.${action}Failed.title` as MessageKey),
        message(`startup.${action}Failed.body` as MessageKey),
      );
    }
  };

  const handleAddExisting = async () => {
    await guarded("openWorkspace", async () => {
      const path = await openJsonFileDialog();
      if (!path) return;
      const loaded = await loadWorkspace(path);
      if (loaded.status !== "success") {
        await showMessage(
          message("startup.workspaceFailed.title"),
          describeLoadFailure("workspace", loaded, path),
        );
        return;
      }
      setNames((current) => ({ ...current, [path]: loaded.workspace.name }));
      if (await register(path)) setSelected(path);
    });
  };

  const handleNew = async () => {
    await guarded("createWorkspace", async () => {
      const path = await saveJsonFileDialog("workspace.json");
      if (!path) return;
      const created = await createWorkspaceFile(path, fileNameWithoutExt(path));
      setNames((current) => ({ ...current, [path]: created.name }));
      if (await register(path)) setSelected(path);
    });
  };

  // Takes the workspace off this list; its file stays where it is.
  const handleRemove = async (path: string) => {
    if (await unregister(path) && selected === path) {
      setSelected(useAppConfigStore.getState().appConfig.knownWorkspaces[0] ?? "");
    }
  };

  const startRename = () => {
    if (!selected) return;
    renamingRef.current = selected;
    setRenaming(selected);
    setRenameValue(nameOf(selected));
  };

  const endRename = () => {
    renamingRef.current = null;
    setRenaming(null);
    listboxRef.current?.focus();
  };

  const submitRename = async () => {
    const path = renamingRef.current;
    if (path === null) return;
    const name = singleLine(renameValue, { minify: true });
    endRename();
    if (!name || name === nameOf(path)) return;
    log.info("rename workspace", { path, name });
    await guarded("renameWorkspace", async () => {
      // The open workspace's store owns its latest state, so it writes the
      // name; any other workspace file is renamed in place.
      const workspace = useWorkspaceStore.getState();
      if (workspace.loaded && workspace.filePath === path) {
        if (!(await workspace.renameWorkspace(name))) throw new Error("workspace write failed");
      } else {
        const renamed = await renameWorkspaceFile(path, name);
        if (renamed.status !== "success") {
          await showMessage(
            message("startup.workspaceFailed.title"),
            describeLoadFailure("workspace", renamed, path),
          );
          return;
        }
      }
      setNames((current) => ({ ...current, [path]: name }));
    });
  };

  const launch = async (path = selected) => {
    if (opening || path === "" || renaming !== null) return;
    setOpening(true);
    try {
      await onLaunch(path);
    } finally {
      setOpening(false);
    }
  };

  // Escape while renaming cancels the rename only; otherwise it cancels a
  // switch, and at first launch or recovery it does nothing.
  const requestClose = () => {
    if (renamingRef.current !== null) endRename();
    else if (!opening) onCancel?.();
  };

  return (
    <>
      <div className="fixed inset-0 bg-background" />
      <AppModal
        title={t("startup.title")}
        onClose={requestClose}
        onRequestClose={requestClose}
        closable={Boolean(onCancel)}
        dimmed={false}
        maxWidth={520}
        footerClassName="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4"
        contentProps={{ onOpenAutoFocus: focusInitial }}
        footer={
          <>
            {onQuit && <Button onClick={onQuit}>{t("startup.quit")}</Button>}
            {onCancel && <Button disabled={opening} onClick={onCancel}>{t("common.cancel")}</Button>}
            <Button variant="primary" onClick={() => void launch()} disabled={opening || selected === "" || renaming !== null}>
              {t("startup.continue")}
            </Button>
          </>
        }
      >
        <fieldset disabled={opening} className="flex min-w-0 w-full flex-col gap-4">
          {/* The commands that add a workspace sit in a toolbar band above the
              list, and those for the selected row under it, so the footer holds
              only the dismiss and the commit. */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void handleNew()}>
              <Plus size={14} />
              {t("startup.new")}
            </Button>
            <Button size="sm" onClick={() => void handleAddExisting()}>
              <FolderOpen size={14} />
              {t("startup.addExisting")}
            </Button>
          </div>
          <p className="text-sm text-ink-soft">{t("startup.description")}</p>
          <div className="flex flex-col gap-2">
            <WorkspaceList
              label={t("startup.title")}
              emptyText={t("startup.noWorkspaces")}
              items={items}
              nameOf={nameOf}
              selected={selected}
              onSelect={setSelected}
              onLaunch={(path) => void launch(path)}
              renaming={renaming}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={() => void submitRename()}
              onRenameCancel={endRename}
              listboxRef={listboxRef}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" disabled={!selected || renaming !== null} onClick={startRename}>
                <Pencil size={14} />
                {t("startup.rename")}
              </Button>
              {/* Forgets the entry; the file itself is untouched, so it is not red. */}
              <Button size="sm" disabled={!selected} onClick={() => selected && void handleRemove(selected)}>
                <X size={14} />
                {t("startup.remove")}
              </Button>
            </div>
          </div>
        </fieldset>
      </AppModal>
    </>
  );
}

// A stable, HTML-safe option id for the workspace list.
function optionDomId(path: string): string {
  return `${LIST_ID}-${rowDomId(path)}`;
}

function WorkspaceList({
  label,
  emptyText,
  items,
  nameOf,
  selected,
  onSelect,
  onLaunch,
  renaming,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  listboxRef,
}: {
  label: string;
  emptyText: string;
  items: string[];
  nameOf: (path: string) => string;
  selected: string;
  onSelect: (path: string) => void;
  onLaunch: (path?: string) => void;
  renaming: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  listboxRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const composing = useComposing();
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming === null) return;
    renameRef.current?.focus();
    renameRef.current?.select();
  }, [renaming]);

  // Active-descendant keeps focus on the listbox, so the browser does not
  // scroll the newly active option for us. Keep keyboard movement visible.
  useEffect(() => {
    if (!selected || !items.includes(selected)) return;
    const option = document.getElementById(optionDomId(selected));
    if (!option || !listboxRef.current?.contains(option)) return;
    option.scrollIntoView?.({ block: "nearest" });
  }, [items, selected, listboxRef]);

  // Selection follows the cursor; Enter opens the selected workspace.
  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || items.length === 0) return;
    if (e.key === "Enter") {
      e.preventDefault();
      onLaunch();
      return;
    }
    const current = Math.max(0, items.indexOf(selected));
    let next: number | null = null;
    if (e.key === "ArrowDown") next = stepIndex(current, 1, items.length);
    else if (e.key === "ArrowUp") next = stepIndex(current, -1, items.length);
    else if (e.key === "PageDown") next = pageStepIndex(current, 1, STARTUP_LIST_PAGE, items.length);
    else if (e.key === "PageUp") next = pageStepIndex(current, -1, STARTUP_LIST_PAGE, items.length);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(items[next]);
  };

  // A real listbox: one tab stop, arrows to move, selection follows the cursor
  // (composite-control-conventions).
  return (
    <div
      ref={listboxRef}
      role="listbox"
      aria-label={label}
      aria-activedescendant={selected ? optionDomId(selected) : undefined}
      tabIndex={0}
      onKeyDown={handleListKeyDown}
      className="max-h-52 overflow-y-auto rounded-[var(--radius-control)] border border-border p-1 outline-none focus:border-primary-ring"
    >
      {items.length === 0 ? (
        <div className="px-2.5 py-1.5 text-sm text-ink-muted">{emptyText}</div>
      ) : (
        items.map((path) => (
          <div
            key={path}
            id={optionDomId(path)}
            role="option"
            aria-selected={selected === path}
            onClick={() => onSelect(path)}
            onDoubleClick={() => { onSelect(path); onLaunch(path); }}
            className={`cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1.5 transition-colors duration-[var(--motion)] ${
              selected === path ? "bg-primary-surface" : "hover:bg-control-hover"
            }`}
          >
            {renaming === path ? (
              <input
                ref={renameRef}
                aria-label={t("startup.workspaceName")}
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onBlur={onRenameSubmit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    if (isComposingKeyboardEvent(composing.composingRef, e)) return;
                    e.preventDefault();
                    onRenameSubmit();
                  }
                  if (e.key === "Escape") {
                    if (isComposingKeyboardEvent(composing.composingRef, e)) return;
                    onRenameCancel();
                  }
                }}
                {...composing.handlers}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="dk-field dk-field-sm w-full"
              />
            ) : (
              // Identifying text, one line each: the name keeps its beginning
              // and the path its root and file, which tell workspaces apart;
              // Rename shows the whole name.
              <span className={`block truncate text-sm font-medium ${selected === path ? "text-primary-hover" : "text-ink"}`}>
                {nameOf(path)}
              </span>
            )}
            <span className="block truncate text-xs text-ink-muted">{shortenPath(path, PATH_COLUMNS)}</span>
          </div>
        ))
      )}
    </div>
  );
}
