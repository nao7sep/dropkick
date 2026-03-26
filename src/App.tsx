// App root — orchestrates the startup picker and main window.
// On launch: initialize app config → show startup picker → load preferences & workspace → show main window.

import { useState, useEffect } from "react";
import "./App.css";
import type { AppConfigDto } from "./models";
import { initializeAppConfig, saveAppConfig } from "./repositories";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { StartupPicker } from "./components/layout/StartupPicker";
import { MainWindow } from "./components/layout/MainWindow";

type AppPhase =
  | { kind: "loading" }
  | { kind: "startup"; config: AppConfigDto }
  | { kind: "main" };

function App() {
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const loadPreferences = usePreferencesStore((s) => s.load);
  const loadWorkspace = useWorkspaceStore((s) => s.load);

  // Initialize on mount.
  useEffect(() => {
    (async () => {
      const { config } = await initializeAppConfig();
      setPhase({ kind: "startup", config });
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

    setPhase({ kind: "main" });
  };

  switch (phase.kind) {
    case "loading":
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <div className="text-gray-400">Loading...</div>
        </div>
      );

    case "startup":
      return (
        <StartupPicker
          appConfig={phase.config}
          onConfigChange={handleConfigChange}
          onLaunch={handleLaunch}
        />
      );

    case "main":
      return <MainWindow />;
  }
}

export default App;
