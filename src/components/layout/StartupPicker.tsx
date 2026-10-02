// Startup picker — shown on every launch.
// User selects a preferences file and a workspace file, then clicks Launch.
//
// Root launch gate, not a stacked modal: it replaces the whole app until the
// user launches and has no "cancel" target, so it is intentionally exempt from
// the *Modal/*Dialog naming rule (recorded as an exempt root surface in the
// modal-dialog conventions).

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowLeft, FolderOpen, Plus, X } from "lucide-react";
import {
  createPreferencesFile,
  createWorkspaceFile,
  loadPreferences,
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
  onLaunch: (preferencesPath: string, workspacePath: string) => void;
}

export function StartupPicker({ onLaunch }: StartupPickerProps) {
  const { t } = useI18n();
  const appState = useAppStateStore((s) => s.appState);
  const appConfig = useAppConfigStore((s) => s.appConfig);
  const registerAndSelect = useAppConfigStore((s) => s.registerAndSelect);
  const unregisterAndReselect = useAppConfigStore((s) => s.unregisterAndReselect);

  const [selectedPrefs, setSelectedPrefs] = useState(
    appState.lastPreferencesPath,
  );
  const [selectedWorkspace, setSelectedWorkspace] = useState(
    appState.lastWorkspacePath,
  );
  const prefsOpenRef = useRef<HTMLButtonElement>(null);
  const workspaceOpenRef = useRef<HTMLButtonElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);

  // The next actionable control: the first empty section's Open button, or
  // the footer's Open once both files are chosen. Shared by the reactive
  // effect below (a selection changes after mount) and AppModal's
  // onOpenAutoFocus (the very first focus, on mount) — Radix's own focus
  // scope activates around that callback, so setting focus reactively
  // afterwards instead of there raced it and lost.
  const focusNextActionable = () => {
    const target =
      selectedPrefs === ""
        ? prefsOpenRef.current
        : selectedWorkspace === ""
          ? workspaceOpenRef.current
          : launchRef.current;

    target?.focus();
  };

  useEffect(focusNextActionable, [selectedPrefs, selectedWorkspace]);

  // Every write this screen performs — creating a file, or recording the
  // selection in state.json — goes through here. Without it a failed write left
  // the rejection to the global unhandled-rejection logger: the button simply
  // did nothing, with no dialog, no selection change and no clue why. TabBar's
  // equivalent already wrapped the identical sequence.
  // `action` names the failure's title and body keys, and the log line.
  const guarded = async (
    action: "openPreferences" | "createPreferences" | "openWorkspace" | "createWorkspace",
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

  const handleOpenPreferences = async () => {
    await guarded("openPreferences", async () => {
      const path = await openJsonFileDialog();
      if (!path) return;
      const loadResult = await loadPreferences(path);
      if (loadResult.status !== "success") {
        await showMessage(
          message("startup.preferencesFailed.title"),
          describeLoadFailure("preferences", loadResult, path),
        );
        return;
      }
      if (await registerAndSelect("preferences", path)) setSelectedPrefs(path);
    });
  };

  const handleNewPreferences = async () => {
    await guarded("createPreferences", async () => {
      const normalizedPath = await saveJsonFileDialog("preferences.json");
      if (!normalizedPath) return;
      await createPreferencesFile(normalizedPath, fileNameWithoutExt(normalizedPath));
      if (await registerAndSelect("preferences", normalizedPath)) setSelectedPrefs(normalizedPath);
    });
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
      if (await registerAndSelect("workspace", path)) setSelectedWorkspace(path);
    });
  };

  const handleNewWorkspace = async () => {
    await guarded("createWorkspace", async () => {
      const normalizedPath = await saveJsonFileDialog("workspace.json");
      if (!normalizedPath) return;
      await createWorkspaceFile(normalizedPath, fileNameWithoutExt(normalizedPath));
      if (await registerAndSelect("workspace", normalizedPath)) setSelectedWorkspace(normalizedPath);
    });
  };

  const handleRemovePreferences = async (path: string) => {
    if (await unregisterAndReselect("preferences", path) && selectedPrefs === path) {
      setSelectedPrefs(useAppStateStore.getState().appState.lastPreferencesPath);
    }
  };

  const handleRemoveWorkspace = async (path: string) => {
    if (await unregisterAndReselect("workspace", path) && selectedWorkspace === path) {
      setSelectedWorkspace(
        useAppStateStore.getState().appState.lastWorkspacePath,
      );
    }
  };

  const canLaunch = selectedPrefs !== "" && selectedWorkspace !== "";

  return (
    <>
      {/* AppModal's own overlay and Dialog.Content positioning already centre
          the card on screen; this just paints the canvas behind it, since —
          unlike every other AppModal use — there is no main window underneath
          to show through (modal-dialog-conventions: root launch gate, not a
          stacked modal, exempt from the *Modal/*Dialog naming rule). */}
      <div className="fixed inset-0 bg-background" />
      {/* Built on the same shared shell every dialog uses, so it can't drift
          from it. Two differences from an ordinary AppModal: `closable=false`
          drops the header's close control and makes Escape and an outside
          click no-ops — there is nothing to close back to — and `dimmed=false`
          skips the backdrop tint, since the card sits on the app's own canvas
          rather than over other content. */}
      <AppModal
        title="Dropkick"
        onClose={() => {}}
        closable={false}
        dimmed={false}
        maxWidth={448}
        // Radix's own default — focus the dialog surface on open — would
        // fight the effect above that advances focus to the next actionable
        // control (the first empty section's Open button, or Open itself
        // once both are chosen); ceding it here lets that effect win.
        contentProps={{
          onOpenAutoFocus: (e) => {
            e.preventDefault();
            focusNextActionable();
          },
        }}
        footer={
          // Opens the selected pair into the main window — the app is already
          // running, so this never reads "Launch"; it reuses the app's own
          // "Open" wording (startup.open), the same term each section's own
          // Open button already carries.
          <Button
            ref={launchRef}
            variant="primary"
            onClick={() => onLaunch(selectedPrefs, selectedWorkspace)}
            disabled={!canLaunch}
            className="min-w-28"
          >
            {t("startup.open")}
          </Button>
        }
      >
        <div className="flex flex-col gap-6">
          {/* Preferences section */}
          <Section
            id="preferences"
            label={t("startup.preferences")}
            emptyText={t("startup.noPreferences")}
            items={appConfig.knownPreferences}
            selected={selectedPrefs}
            onSelect={setSelectedPrefs}
            onOpen={handleOpenPreferences}
            onNew={handleNewPreferences}
            onRemove={handleRemovePreferences}
            openButtonRef={prefsOpenRef}
          />

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
        </div>
      </AppModal>
    </>
  );
}

// A stable, HTML-safe option id. Prefixed with the section id because the
// same path could legitimately appear in both lists.
function optionDomId(section: string, path: string): string {
  return `${section}-${rowDomId(path)}`;
}

// Reusable section for preferences and workspace selection.
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
          {t("startup.open")}
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
