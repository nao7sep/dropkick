// Main window — shown after startup picker.
// Placeholder for now — will contain tab bar, left pane, and right pane.

import { usePreferencesStore } from "../../state/preferences-store";
import { useWorkspaceStore } from "../../state/workspace-store";

export function MainWindow() {
  const preferences = usePreferencesStore((s) => s.preferences);
  const workspace = useWorkspaceStore((s) => s.workspace);

  return (
    <div
      className="flex h-screen flex-col bg-gray-50"
      style={{
        fontFamily: preferences.fontFamily,
        fontSize: `${preferences.fontSize}px`,
      }}
    >
      {/* Tab bar area */}
      <div className="flex h-10 items-center border-b border-gray-200 bg-white px-2">
        <span className="text-sm font-medium text-gray-600">
          {workspace.name}
        </span>
        <span className="ml-2 text-xs text-gray-400">
          {workspace.openTabs.length === 0
            ? "No tabs open — click + to get started"
            : `${workspace.openTabs.length} tab(s)`}
        </span>
      </div>

      {/* Content area placeholder */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-lg">Welcome to Dropkick</p>
          <p className="mt-2 text-sm">
            Open a task list file or create a new one to get started.
          </p>
        </div>
      </div>
    </div>
  );
}
