// App root — orchestrates the startup picker and main window.
// On launch: initialize app config → show startup picker → load preferences & workspace → show main window.

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { computeMinWindowWidth, computeMinWindowHeight } from "./utils";
import "./App.css";
import type { LoadPreferencesResult, LoadWorkspaceResult } from "./repositories";
import { showMessage, log, toErrorFields, loadFailureFields } from "./repositories";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { useAppConfigStore } from "./state/app-config-store";
import { StartupPicker } from "./components/layout/StartupPicker";
import { StartupErrorScreen } from "./components/layout/StartupErrorScreen";
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
  // Guards against a double Launch: phase stays "startup" until the awaited
  // loads finish, so two quick clicks would otherwise both run the sequence.
  const launchingRef = useRef(false);

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

  // Enforce the content-based minimum window size once at startup. The minimum
  // is DERIVED from the pane minimums plus the fixed tab bar (windowSizing.ts),
  // not a literal in tauri.conf.json, so the window can never shrink below what
  // its panes need and the two sources can never drift apart. Below this, the
  // OS refuses to shrink the window, so no pane is ever squeezed out.
  useEffect(() => {
    getCurrentWindow()
      .setMinSize(
        new LogicalSize(computeMinWindowWidth(), computeMinWindowHeight()),
      )
      .catch((e) => log.warn("window setMinSize failed", toErrorFields(e)));
  }, []);

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
    if (phase.kind !== "startup" || launchingRef.current) return;
    launchingRef.current = true;
    try {
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

      // The just-in-case data backup is no longer a startup pass: it is now a
      // write-through store in the Rust core that records every managed-text save
      // the instant its atomic rename lands (see backup_store.rs). There is
      // nothing to kick off here.
      const workspace = useWorkspaceStore.getState().workspace;

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
    } finally {
      // On failure, allow a retry; on success the picker unmounts so this is moot.
      launchingRef.current = false;
    }
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
      content = <StartupErrorScreen message={phase.message} />;
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
