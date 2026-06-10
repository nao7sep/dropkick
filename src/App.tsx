// App root — orchestrates the startup picker and main window.
// On launch: initialize app config → show startup picker → load preferences & workspace → show main window.

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import type { LoadPreferencesResult, LoadWorkspaceResult } from "./repositories";
import { showMessage, log, toErrorFields, loadFailureFields } from "./repositories";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { useAppConfigStore } from "./state/app-config-store";
import { startBackupSchedule } from "./services";
import { StartupPicker } from "./components/layout/StartupPicker";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";
import { ToastHost } from "./components/shared/ToastHost";

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
  const darkMode = usePreferencesStore((s) => s.preferences.darkMode);

  // Apply the theme to <html> so it covers the startup picker, main window, and
  // every Radix modal (those portal to <body>, outside the React tree). The
  // `.dark` class flips the token overrides defined in App.css. Defaults to
  // light until a preferences file loads.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    // Also sync the native window theme. The OS paints the window backing with
    // this theme's color during a resize, before the webview repaints — so a
    // dark window theme prevents the white flash when enlarging in dark mode.
    getCurrentWindow()
      .setTheme(darkMode ? "dark" : "light")
      .catch((e) => log.warn("window setTheme failed", { darkMode, ...toErrorFields(e) }));
  }, [darkMode]);

  // Initialize on mount.
  useEffect(() => {
    (async () => {
      try {
        await initializeAppConfig();
        setPhase({ kind: "startup" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error("app initialization failed", toErrorFields(e));
        setPhase({ kind: "error", message });
      }
    })();
  }, [initializeAppConfig]);

  const handleLaunch = async (
    preferencesPath: string,
    workspacePath: string,
  ) => {
    if (phase.kind !== "startup") return;

    log.info("user launch", { preferencesPath, workspacePath });

    // Load preferences and workspace into stores.
    const preferencesResult = await loadPreferences(preferencesPath);
    if (preferencesResult.status !== "success") {
      log.warn(
        "preferences load failed",
        loadFailureFields(preferencesPath, preferencesResult),
      );
      await showMessage(
        "Preferences Load Failed",
        preferencesLoadErrorMessage(preferencesPath, preferencesResult),
      );
      return;
    }

    const workspaceResult = await loadWorkspace(workspacePath);
    if (workspaceResult.status !== "success") {
      log.warn(
        "workspace load failed",
        loadFailureFields(workspacePath, workspaceResult),
      );
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

    // Record the effective configuration once the session is live: the
    // preferences object (no secret-bearing fields) and a workspace summary.
    const preferences = preferencesResult.preferences;
    log.info("session ready", {
      preferences,
      workspace: {
        id: workspace.id,
        openTabs: workspace.openTabs.length,
        recentFiles: workspace.recentFiles.length,
      },
    });

    setPhase({ kind: "main" });
  };

  let content: ReactNode;

  switch (phase.kind) {
    case "loading":
      content = (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="text-ink-muted">Loading...</div>
        </div>
      );
      break;

    case "error":
      content = (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="max-w-md rounded-lg bg-surface p-6 shadow-lg">
            <h2 className="mb-2 text-lg font-bold text-danger">
              Startup Error
            </h2>
            <p className="text-sm text-ink-soft">{phase.message}</p>
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
      <ToastHost />
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
