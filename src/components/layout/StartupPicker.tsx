// Startup picker — shown on every launch.
// User selects a preferences file and a workspace file, then clicks Launch.

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import type { AppConfigDto } from "../../models";
import {
  createPreferencesFile,
  createWorkspaceFile,
  openJsonFileDialog,
  registerPreferencesPath,
  registerWorkspacePath,
  saveJsonFileDialog,
  unregisterPreferencesPath,
  unregisterWorkspacePath,
} from "../../repositories";

interface StartupPickerProps {
  appConfig: AppConfigDto;
  onConfigChange: (config: AppConfigDto) => void;
  onLaunch: (preferencesPath: string, workspacePath: string) => void;
}

export function StartupPicker({
  appConfig,
  onConfigChange,
  onLaunch,
}: StartupPickerProps) {
  const [selectedPrefs, setSelectedPrefs] = useState(
    appConfig.lastPreferencesPath,
  );
  const [selectedWorkspace, setSelectedWorkspace] = useState(
    appConfig.lastWorkspacePath,
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

  const handleOpenPreferences = async () => {
    const path = await openJsonFileDialog();
    if (!path) return;
    const updated = await registerPreferencesPath(appConfig, path);
    onConfigChange(updated);
    setSelectedPrefs(path);
  };

  const handleNewPreferences = async () => {
    const path = await saveJsonFileDialog("preferences.json");
    if (!path) return;
    const normalizedPath = path.endsWith(".json") ? path : `${path}.json`;
    await createPreferencesFile(normalizedPath, fileNameWithoutExt(normalizedPath));
    const updated = await registerPreferencesPath(appConfig, normalizedPath);
    onConfigChange(updated);
    setSelectedPrefs(normalizedPath);
  };

  const handleOpenWorkspace = async () => {
    const path = await openJsonFileDialog();
    if (!path) return;
    const updated = await registerWorkspacePath(appConfig, path);
    onConfigChange(updated);
    setSelectedWorkspace(path);
  };

  const handleNewWorkspace = async () => {
    const path = await saveJsonFileDialog("workspace.json");
    if (!path) return;
    const normalizedPath = path.endsWith(".json") ? path : `${path}.json`;
    await createWorkspaceFile(normalizedPath, fileNameWithoutExt(normalizedPath));
    const updated = await registerWorkspacePath(appConfig, normalizedPath);
    onConfigChange(updated);
    setSelectedWorkspace(normalizedPath);
  };

  const handleRemovePreferences = async (path: string) => {
    const updated = await unregisterPreferencesPath(appConfig, path);
    onConfigChange(updated);
    if (selectedPrefs === path) {
      setSelectedPrefs(updated.lastPreferencesPath);
    }
  };

  const handleRemoveWorkspace = async (path: string) => {
    const updated = await unregisterWorkspacePath(appConfig, path);
    onConfigChange(updated);
    if (selectedWorkspace === path) {
      setSelectedWorkspace(updated.lastWorkspacePath);
    }
  };

  const canLaunch = selectedPrefs !== "" && selectedWorkspace !== "";

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-lg rounded-lg bg-white p-8 shadow-lg">
        <h1 className="mb-8 text-center text-2xl font-bold text-gray-800">
          Dropkick
        </h1>

        {/* Preferences section */}
        <Section
          label="Preferences"
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
          label="Workspace"
          items={appConfig.knownWorkspaces}
          selected={selectedWorkspace}
          onSelect={setSelectedWorkspace}
          onOpen={handleOpenWorkspace}
          onNew={handleNewWorkspace}
          onRemove={handleRemoveWorkspace}
          openButtonRef={workspaceOpenRef}
        />

        {/* Launch action */}
        <div className="mt-6 flex justify-end border-t border-gray-200 pt-4">
          <button
            ref={launchRef}
            onClick={() => onLaunch(selectedPrefs, selectedWorkspace)}
            disabled={!canLaunch}
            className="min-w-28 rounded-md bg-sky-700 px-4 py-2 font-medium text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
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
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </label>

      <div className="max-h-36 overflow-y-auto rounded-md border border-gray-200">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-500">
            No {label.toLowerCase()} files configured
          </div>
        ) : (
          items.map((path) => (
            <div
              key={path}
              onClick={() => onSelect(path)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${
                selected === path
                  ? "bg-sky-50 text-sky-800"
                  : "text-gray-600"
              }`}
            >
              <span className="mr-2 min-w-0 truncate" title={path}>
                {path}
              </span>
              {selected === path && (
                <span className="shrink-0 text-xs text-sky-700">←</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          ref={openButtonRef}
          onClick={onOpen}
          className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          <FolderOpen size={14} />
          Open
        </button>
        <button
          onClick={onNew}
          className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          <Plus size={14} />
          New
        </button>
        {selected && (
          <button
            onClick={() => onRemove(selected)}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50"
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

function fileNameWithoutExt(path: string): string {
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? "default";
  return name.replace(/\.json$/, "");
}
