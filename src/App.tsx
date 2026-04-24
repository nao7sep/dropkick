// App root — orchestrates the startup picker and main window.
// On launch: initialize app config → show startup picker → load preferences & workspace → show main window.

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import "./App.css";
import type { AppConfigDto } from "./models";
import { initializeAppConfig, saveAppConfig } from "./repositories";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { startBackupSchedule } from "./services";
import { StartupPicker } from "./components/layout/StartupPicker";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";

type AppPhase =
  | { kind: "loading" }
  | { kind: "startup"; config: AppConfigDto }
  | { kind: "error"; message: string }
  | { kind: "main" };

function App() {
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const loadPreferences = usePreferencesStore((s) => s.load);
  const loadWorkspace = useWorkspaceStore((s) => s.load);

  // Initialize on mount.
  useEffect(() => {
    (async () => {
      try {
        const { config } = await initializeAppConfig();
        setPhase({ kind: "startup", config });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Failed to initialize:", e);
        setPhase({ kind: "error", message });
      }
    })();
  }, []);

  const handleConfigChange = (config: AppConfigDto) => {
    setPhase({ kind: "startup", config });
  };

  const handleLaunch = async (
    preferencesPath: string,
    workspacePath: string,
  ) => {
    if (phase.kind !== "startup") return;

    // Remember the selection.
    const updated = {
      ...phase.config,
      lastPreferencesPath: preferencesPath,
      lastWorkspacePath: workspacePath,
    };
    await saveAppConfig(updated);

    // Load preferences and workspace into stores.
    await loadPreferences(preferencesPath);
    await loadWorkspace(workspacePath);

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
      content = (
        <StartupPicker
          appConfig={phase.config}
          onConfigChange={handleConfigChange}
          onLaunch={handleLaunch}
        />
      );
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

export default App;
