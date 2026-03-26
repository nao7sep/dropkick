// Startup picker — shown on every launch.
// User selects a preferences file and a workspace file, then clicks Launch.

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { AppConfigDto } from "../../models";
import {
  readJsonFile,
  saveJsonFileDialog,
  registerPreferencesPath,
  registerWorkspacePath,
  unregisterPreferencesPath,
  unregisterWorkspacePath,
  createPreferencesFile,
  createWorkspaceFile,
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

  const handleAddPreferences = async () => {
    // Save dialog handles both creating new and selecting existing.
    const path = await saveJsonFileDialog("preferences.json");
    if (!path) return;

    // Try opening as existing first; if it doesn't parse, create new.
    const openPath = await tryOpenOrCreate(path, async (p) => {
      await createPreferencesFile(p, fileNameWithoutExt(p));
    });

    const updated = await registerPreferencesPath(appConfig, openPath);
    onConfigChange(updated);
    setSelectedPrefs(openPath);
  };

  const handleAddWorkspace = async () => {
    const path = await saveJsonFileDialog("workspace.json");
    if (!path) return;

    const openPath = await tryOpenOrCreate(path, async (p) => {
      await createWorkspaceFile(p, fileNameWithoutExt(p));
    });

    const updated = await registerWorkspacePath(appConfig, openPath);
    onConfigChange(updated);
    setSelectedWorkspace(openPath);
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
          onAdd={handleAddPreferences}
          onRemove={handleRemovePreferences}
        />

        {/* Workspace section */}
        <Section
          label="Workspace"
          items={appConfig.knownWorkspaces}
          selected={selectedWorkspace}
          onSelect={setSelectedWorkspace}
          onAdd={handleAddWorkspace}
          onRemove={handleRemoveWorkspace}
        />

        {/* Launch button */}
        <button
          onClick={() => onLaunch(selectedPrefs, selectedWorkspace)}
          disabled={!canLaunch}
          className="mt-6 w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Launch
        </button>
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
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  selected: string;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <div className="mb-6">
      <label className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </label>

      <div className="max-h-36 overflow-y-auto rounded-md border border-gray-200">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gray-400">
            No {label.toLowerCase()} files configured
          </div>
        ) : (
          items.map((path) => (
            <div
              key={path}
              onClick={() => onSelect(path)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-50 ${
                selected === path
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600"
              }`}
            >
              <span className="mr-2 min-w-0 truncate" title={path}>
                {path}
              </span>
              {selected === path && (
                <span className="shrink-0 text-xs text-blue-500">←</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          onClick={onAdd}
          className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          <Plus size={14} />
          Open/New
        </button>
        {selected && (
          <button
            onClick={() => onRemove(selected)}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-red-500 transition-colors hover:bg-red-50"
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
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "default";
  return name.replace(/\.json$/, "");
}

async function tryOpenOrCreate(
  path: string,
  createFn: (path: string) => Promise<void>,
): Promise<string> {
  // If the file doesn't end with .json, add the extension.
  const normalizedPath = path.endsWith(".json") ? path : `${path}.json`;

  try {
    // Try to read it — if it exists and is valid JSON, it's an existing file.
    const existing = await readJsonFile(normalizedPath);
    if (existing !== null) return normalizedPath;
  } catch {
    // Not valid JSON or doesn't exist — create new.
  }

  await createFn(normalizedPath);
  return normalizedPath;
}
