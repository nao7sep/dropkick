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
import { useAppStateStore } from "../../state/app-state-store";
import { describeLoadFailure, fileNameWithoutExt } from "../../services";

interface StartupPickerProps {
  onLaunch: (preferencesPath: string, workspacePath: string) => void;
}

export function StartupPicker({ onLaunch }: StartupPickerProps) {
  const appState = useAppStateStore((s) => s.appState);
  const registerPreferences = useAppStateStore((s) => s.registerPreferences);
  const registerWorkspace = useAppStateStore((s) => s.registerWorkspace);
  const unregisterPreferences = useAppStateStore(
    (s) => s.unregisterPreferences,
  );
  const unregisterWorkspace = useAppStateStore((s) => s.unregisterWorkspace);

  const [selectedPrefs, setSelectedPrefs] = useState(
    appState.lastPreferencesPath,
  );
  const [selectedWorkspace, setSelectedWorkspace] = useState(
    appState.lastWorkspacePath,
  );
  const prefsOpenRef = useRef<HTMLButtonElement>(null);
  const workspaceOpenRef = useRef<HTMLButtonElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target =
      selectedPrefs === ""
        ? prefsOpenRef.current
        : selectedWorkspace === ""
          ? workspaceOpenRef.current
          : launchRef.current;

    target?.focus();
  }, [selectedPrefs, selectedWorkspace]);

  // Every write this screen performs — creating a file, or recording the
  // selection in state.json — goes through here. Without it a failed write left
  // the rejection to the global unhandled-rejection logger: the button simply
  // did nothing, with no dialog, no selection change and no clue why. TabBar's
  // equivalent already wrapped the identical sequence.
  const guarded = async (
    title: string,
    what: string,
    run: () => Promise<void>,
  ): Promise<void> => {
    try {
      await run();
    } catch (e) {
      log.error("startup picker action failed", { action: what, ...toErrorFields(e) });
      await showMessage(
        title,
        `${what} could not be completed:\n\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const handleOpenPreferences = async () => {
    const path = await openJsonFileDialog();
    if (!path) return;
    const loadResult = await loadPreferences(path);
    if (loadResult.status !== "success") {
      await showMessage(
        "Preferences Load Failed",
        describeLoadFailure("preferences", loadResult, path),
      );
      return;
    }
    await guarded("Open Preferences Failed", "Opening the preferences file", async () => {
      await registerPreferences(path);
      setSelectedPrefs(path);
    });
  };

  const handleNewPreferences = async () => {
    const normalizedPath = await saveJsonFileDialog("preferences.json");
    if (!normalizedPath) return;
    await guarded("Create Preferences Failed", "Creating the preferences file", async () => {
      await createPreferencesFile(normalizedPath, fileNameWithoutExt(normalizedPath));
      await registerPreferences(normalizedPath);
      setSelectedPrefs(normalizedPath);
    });
  };

  const handleOpenWorkspace = async () => {
    const path = await openJsonFileDialog();
    if (!path) return;
    const loadResult = await loadWorkspace(path);
    if (loadResult.status !== "success") {
      await showMessage(
        "Workspace Load Failed",
        describeLoadFailure("workspace", loadResult, path),
      );
      return;
    }
    await guarded("Open Workspace Failed", "Opening the workspace file", async () => {
      await registerWorkspace(path);
      setSelectedWorkspace(path);
    });
  };

  const handleNewWorkspace = async () => {
    const normalizedPath = await saveJsonFileDialog("workspace.json");
    if (!normalizedPath) return;
    await guarded("Create Workspace Failed", "Creating the workspace file", async () => {
      await createWorkspaceFile(normalizedPath, fileNameWithoutExt(normalizedPath));
      await registerWorkspace(normalizedPath);
      setSelectedWorkspace(normalizedPath);
    });
  };

  const handleRemovePreferences = async (path: string) => {
    await unregisterPreferences(path);
    if (selectedPrefs === path) {
      setSelectedPrefs(useAppStateStore.getState().appState.lastPreferencesPath);
    }
  };

  const handleRemoveWorkspace = async (path: string) => {
    await unregisterWorkspace(path);
    if (selectedWorkspace === path) {
      setSelectedWorkspace(
        useAppStateStore.getState().appState.lastWorkspacePath,
      );
    }
  };

  const canLaunch = selectedPrefs !== "" && selectedWorkspace !== "";

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-lg rounded-lg bg-surface p-8 shadow-lg">
        <h1 className="mb-8 text-center text-2xl font-bold text-ink-strong">
          Dropkick
        </h1>

        {/* Preferences section */}
        <Section
          label="Preferences"
          items={appState.knownPreferences}
          selected={selectedPrefs}
          onSelect={setSelectedPrefs}
          onOpen={handleOpenPreferences}
          onNew={handleNewPreferences}
          onRemove={handleRemovePreferences}
          openButtonRef={prefsOpenRef}
        />

        {/* Workspace section */}
        <Section
          label="Workspace"
          items={appState.knownWorkspaces}
          selected={selectedWorkspace}
          onSelect={setSelectedWorkspace}
          onOpen={handleOpenWorkspace}
          onNew={handleNewWorkspace}
          onRemove={handleRemoveWorkspace}
          openButtonRef={workspaceOpenRef}
        />

        {/* Launch action */}
        <div className="mt-6 flex justify-end border-t border-border pt-4">
          <button
            ref={launchRef}
            onClick={() => onLaunch(selectedPrefs, selectedWorkspace)}
            disabled={!canLaunch}
            className="min-w-28 rounded-md bg-primary-solid px-4 py-2 font-medium text-ink-inverted transition-colors hover:bg-primary-solid-hover disabled:bg-background disabled:text-ink-muted"
          >
            Launch
          </button>
        </div>
      </div>
    </div>
  );
}

// Reusable section for preferences and workspace selection.
function Section({
  label,
  items,
  selected,
  onSelect,
  onOpen,
  onNew,
  onRemove,
  openButtonRef,
}: {
  label: string;
  items: string[];
  selected: string;
  onSelect: (path: string) => void;
  onOpen: () => void;
  onNew: () => void;
  onRemove: (path: string) => void;
  openButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div className="mb-6">
      <label className="mb-2 block text-sm font-medium text-ink">
        {label}
      </label>

      <div className="max-h-36 overflow-y-auto rounded-md border border-border">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-ink-muted">
            No {label.toLowerCase()} files configured
          </div>
        ) : (
          items.map((path) => (
            <div
              key={path}
              onClick={() => onSelect(path)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-background ${
                selected === path
                  ? "bg-primary-surface text-primary-hover"
                  : "text-ink-soft"
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
        <button
          ref={openButtonRef}
          onClick={onOpen}
          className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-background"
        >
          <FolderOpen size={14} />
          Open
        </button>
        <button
          onClick={onNew}
          className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-sm text-ink-soft transition-colors hover:bg-background"
        >
          <Plus size={14} />
          New
        </button>
        {selected && (
          <button
            onClick={() => onRemove(selected)}
            className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-sm text-danger transition-colors hover:bg-danger-surface"
          >
            <X size={14} />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// Helpers



