// App root — orchestrates the startup picker and main window.
// On launch: initialize app config → show startup picker → load preferences & workspace → show main window.

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import "./App.css";
import type { LoadPreferencesResult, LoadWorkspaceResult } from "./repositories";
import { showMessage } from "./repositories";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { useAppConfigStore } from "./state/app-config-store";
import { startBackupSchedule } from "./services";
import { StartupPicker } from "./components/layout/StartupPicker";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";

type AppPhase =
  | { kind: "loading" }
  | { kind: "startup" }
  | { kind: "error"; message: string }
  | { kind: "main" };

function App() {
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const loadPreferences = usePreferencesStore((s) => s.load);
  const loadWorkspace = useWorkspaceStore((s) => s.load);
  const initializeAppConfig = useAppConfigStore((s) => s.initialize);
  const setLastPaths = useAppConfigStore((s) => s.setLastPaths);

  // Initialize on mount.
  useEffect(() => {
    (async () => {
      try {
        await initializeAppConfig();
        setPhase({ kind: "startup" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Failed to initialize:", e);
        setPhase({ kind: "error", message });
      }
    })();
  }, [initializeAppConfig]);

  const handleLaunch = async (
    preferencesPath: string,
    workspacePath: string,
  ) => {
    if (phase.kind !== "startup") return;

    // Load preferences and workspace into stores.
    const preferencesResult = await loadPreferences(preferencesPath);
    if (preferencesResult.status !== "success") {
      await showMessage(
        "Preferences Load Failed",
        preferencesLoadErrorMessage(preferencesPath, preferencesResult),
      );
      return;
    }

    const workspaceResult = await loadWorkspace(workspacePath);
    if (workspaceResult.status !== "success") {
      await showMessage(
        "Workspace Load Failed",
        workspaceLoadErrorMessage(workspacePath, workspaceResult),
      );
      return;
    }

    // Remember only a successfully loaded selection.
    await setLastPaths(preferencesPath, workspacePath);

    // Start backup system: immediate backup + periodic backups every hour.
    // Does not block the main window from appearing.
    const workspace = useWorkspaceStore.getState().workspace;
    startBackupSchedule(workspace.id, preferencesPath, workspacePath);

    setPhase({ kind: "main" });
  };

  let content: ReactNode;

  switch (phase.kind) {
    case "loading":
      content = (
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <div className="text-gray-500">Loading...</div>
        </div>
      );
      break;

    case "error":
      content = (
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <div className="max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-2 text-lg font-bold text-red-700">
              Startup Error
            </h2>
            <p className="text-sm text-gray-600">{phase.message}</p>
          </div>
        </div>
      );
      break;

    case "startup":
      content = <StartupPicker onLaunch={handleLaunch} />;
      break;

    case "main":
      content = <MainWindow />;
      break;
  }

  return (
    <>
      {content}
      <AppDialogHost />
    </>
  );
}

function preferencesLoadErrorMessage(
  path: string,
  result: Exclude<LoadPreferencesResult, { status: "success" }>,
): string {
  if (result.status === "missing") {
    return `The preferences file could not be found:\n\n${path}`;
  }
  return `The preferences file could not be loaded:\n\n${path}\n\n${result.message}`;
}

function workspaceLoadErrorMessage(
  path: string,
  result: Exclude<LoadWorkspaceResult, { status: "success" }>,
): string {
  if (result.status === "missing") {
    return `The workspace file could not be found:\n\n${path}`;
  }
  return `The workspace file could not be loaded:\n\n${path}\n\n${result.message}`;
}

export default App;
