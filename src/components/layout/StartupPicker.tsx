// Select a workspace during recovery or an explicit switch.
// Its selection is local until the workspace opens successfully. A switch can be
// cancelled; initial recovery always offers Quit. Drafts stay in session stores.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowLeft, FolderOpen, Plus, X } from "lucide-react";
import {
  createWorkspaceFile,
  loadWorkspace,
  openJsonFileDialog,
  saveJsonFileDialog,
  showMessage,
  log,
  toErrorFields,
} from "../../repositories";
import { useAppConfigStore } from "../../state/app-config-store";
import { useAppStateStore } from "../../state/app-state-store";
import { describeLoadFailure, fileNameWithoutExt } from "../../services";
import { pageStepIndex, rowDomId, stepIndex } from "../../utils";
import { useI18n } from "../../i18n/I18nContext";
import { AppModal } from "../shared/AppModal";
import { Button } from "../shared/Button";
import type { MessageKey } from "../../i18n/catalogues";
import { message } from "../../i18n/translate";

const STARTUP_LIST_PAGE = 4;

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

  const [selectedWorkspace, setSelectedWorkspace] = useState(
    appConfig.knownWorkspaces.includes(appState.lastWorkspacePath)
      ? appState.lastWorkspacePath : (appConfig.knownWorkspaces[0] ?? ""),
  );
  const [opening, setOpening] = useState(false);
  const workspaceOpenRef = useRef<HTMLButtonElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);

  // The next actionable control: the first empty section's Open button, or
  // the footer's Open once a workspace is chosen. Shared by the reactive
  // effect below (a selection changes after mount) and AppModal's
  // onOpenAutoFocus (the very first focus, on mount) — Radix's own focus
  // scope activates around that callback, so setting focus reactively
  // afterwards instead of there raced it and lost.
  const focusNextActionable = () => {
    const target = selectedWorkspace === "" ? workspaceOpenRef.current : launchRef.current;

    target?.focus();
  };

  useEffect(focusNextActionable, [selectedWorkspace]);

  // Native selection, document creation and saved-location writes report failures here.
  const guarded = async (
    action: "openWorkspace" | "createWorkspace",
    run: () => Promise<void>,
  ): Promise<void> => {
    try {
      await run();
    } catch (e) {
      log.error("startup picker action failed", { action, ...toErrorFields(e) });
      await showMessage(
        message(`startup.${action}Failed.title` as MessageKey),
        message(`startup.${action}Failed.body` as MessageKey),
      );
    }
  };

  const handleOpenWorkspace = async () => {
    await guarded("openWorkspace", async () => {
      const path = await openJsonFileDialog();
      if (!path) return;
      const loadResult = await loadWorkspace(path);
      if (loadResult.status !== "success") {
        await showMessage(
          message("startup.workspaceFailed.title"),
          describeLoadFailure("workspace", loadResult, path),
        );
        return;
      }
      if (await register(path)) setSelectedWorkspace(path);
    });
  };

  const handleNewWorkspace = async () => {
    await guarded("createWorkspace", async () => {
      const normalizedPath = await saveJsonFileDialog("workspace.json");
      if (!normalizedPath) return;
      await createWorkspaceFile(normalizedPath, fileNameWithoutExt(normalizedPath));
      if (await register(normalizedPath)) setSelectedWorkspace(normalizedPath);
    });
  };

  const handleRemoveWorkspace = async (path: string) => {
    if (await unregister(path) && selectedWorkspace === path) {
      setSelectedWorkspace(
        useAppConfigStore.getState().appConfig.knownWorkspaces[0] ?? "",
      );
    }
  };

  const canLaunch = selectedWorkspace !== "";

  return (
    <>
      <div className="fixed inset-0 bg-background" />
      <AppModal
        title="Dropkick"
        onClose={() => { if (!opening) onCancel?.(); }}
        closable={Boolean(onCancel)}
        dimmed={false}
        maxWidth={520}
        footerClassName="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4"
        // Radix's own default — focus the dialog surface on open — would
        // fight the effect above that advances focus to the next actionable
        // control (the first empty section's Open button, or Open itself
        // once it is chosen); ceding it here lets that effect win.
        contentProps={{
          onOpenAutoFocus: (e) => {
            e.preventDefault();
            focusNextActionable();
          },
        }}
        footer={
          <>
            {onQuit && <Button onClick={onQuit}>{t("startup.quit")}</Button>}
            {onCancel && <Button disabled={opening} onClick={onCancel}>{t("common.cancel")}</Button>}
            <Button ref={launchRef} variant="primary" onClick={async () => { if (opening) return; setOpening(true); try { await onLaunch(selectedWorkspace); } finally { setOpening(false); } }} disabled={opening || !canLaunch}>
              {t("startup.continue")}
            </Button>
          </>
        }
      >
        <fieldset disabled={opening} className="flex min-w-0 w-full flex-col gap-6">
          <p className="text-sm text-ink-soft">{t("startup.description")}</p>
          {/* Workspace section */}
          <Section
            id="workspace"
            label={t("startup.workspace")}
            emptyText={t("startup.noWorkspaces")}
            items={appConfig.knownWorkspaces}
            selected={selectedWorkspace}
            onSelect={setSelectedWorkspace}
            onOpen={handleOpenWorkspace}
            onNew={handleNewWorkspace}
            onRemove={handleRemoveWorkspace}
            openButtonRef={workspaceOpenRef}
          />
        </fieldset>
      </AppModal>
    </>
  );
}

// A stable, HTML-safe option id for the workspace list.
function optionDomId(section: string, path: string): string {
  return `${section}-${rowDomId(path)}`;
}

// Saved workspace selection.
function Section({
  id,
  label,
  emptyText,
  items,
  selected,
  onSelect,
  onOpen,
  onNew,
  onRemove,
  openButtonRef,
}: {
  id: string;
  label: string;
  emptyText: string;
  items: string[];
  selected: string;
  onSelect: (path: string) => void;
  onOpen: () => void;
  onNew: () => void;
  onRemove: (path: string) => void;
  openButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useI18n();
  const listboxRef = useRef<HTMLDivElement>(null);

  // Active-descendant keeps focus on the listbox, so the browser does not
  // scroll the newly active option for us. Keep keyboard movement visible.
  useEffect(() => {
    if (!selected || !items.includes(selected)) return;
    const option = document.getElementById(optionDomId(id, selected));
    if (!option || !listboxRef.current?.contains(option)) return;
    option.scrollIntoView?.({ block: "nearest" });
  }, [items, id, selected]);

  // Selection follows the cursor, which is this list's whole purpose — there is
  // nothing to "open", only a file to choose.
  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (items.length === 0) return;
    const current = Math.max(0, items.indexOf(selected));
    let next: number | null = null;
    if (e.key === "ArrowDown") next = stepIndex(current, 1, items.length);
    else if (e.key === "ArrowUp") next = stepIndex(current, -1, items.length);
    else if (e.key === "PageDown") {
      next = pageStepIndex(current, 1, STARTUP_LIST_PAGE, items.length);
    } else if (e.key === "PageUp") {
      next = pageStepIndex(current, -1, STARTUP_LIST_PAGE, items.length);
    } else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(items[next]);
  };

  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-ink">
        {label}
      </label>

      {/* A real listbox, not a stack of clickable divs: this list drives the
          launch gate's only decision, and a keyboard-only user could otherwise
          reach Open / New / Remove / Launch but never change which file is
          selected — switching workspaces meant re-picking the same file through
          the native dialog. One tab stop, arrows to move, selection follows the
          cursor (composite-control-conventions). */}
      <div
        ref={listboxRef}
        role="listbox"
        aria-label={label}
        aria-activedescendant={selected ? optionDomId(id, selected) : undefined}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="max-h-36 overflow-y-auto rounded-[var(--radius-control)] border border-border p-1 outline-none focus:border-primary-ring"
      >
        {items.length === 0 ? (
          <div className="px-2.5 py-1.5 text-sm text-ink-muted">
            {emptyText}
          </div>
        ) : (
          items.map((path) => (
            <div
              key={path}
              id={optionDomId(id, path)}
              role="option"
              aria-selected={selected === path}
              onClick={() => onSelect(path)}
              className={`flex cursor-pointer items-center justify-between rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm transition-colors duration-[var(--motion)] ${
                selected === path
                  ? "bg-primary-surface text-primary-hover"
                  : "text-ink-soft hover:bg-control-hover"
              }`}
            >
              <span className="mr-2 min-w-0 truncate" title={path}>
                {path}
              </span>
              {selected === path && (
                <ArrowLeft size={14} className="shrink-0 text-primary" />
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <Button ref={openButtonRef} size="sm" onClick={onOpen}>
          <FolderOpen size={14} />
          {t("startup.browse")}
        </Button>
        <Button size="sm" onClick={onNew}>
          <Plus size={14} />
          {t("startup.new")}
        </Button>
        {/* Forgets the entry; the file itself is untouched, so it is not red. */}
        {selected && (
          <Button size="sm" onClick={() => onRemove(selected)}>
            <X size={14} />
            {t("startup.remove")}
          </Button>
        )}
      </div>
    </div>
  );
}
