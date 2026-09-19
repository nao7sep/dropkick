// App root — orchestrates the startup picker and main window.
// On launch: initialize app state → preview the last preferences → show the startup
// picker → load its selected preferences and workspace → show the main window.

import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
} from "@tauri-apps/api/window";
import {
  computeMinWindowWidth,
  computeMinWindowHeight,
  TAB_BAR_MIN_HEIGHT,
  boundNativeMinimumToClient,
} from "./utils";
import "./App.css";
import {
  applyLanguage,
  applyWindowTheme,
  showMessage,
  log,
  toErrorFields,
  loadFailureFields,
} from "./repositories";
import { DEFAULT_UI_FONT_STACK } from "./models";
import { usePreferencesStore } from "./state/preferences-store";
import { useWorkspaceStore } from "./state/workspace-store";
import { useAppStateStore } from "./state/app-state-store";
import { useNoteDraftStore } from "./state/note-draft-store";
import { useLanguageStore } from "./state/language-store";
import { useInterfaceLanguage } from "./hooks/useInterfaceLanguage";
import { I18nProvider } from "./i18n/I18nContext";
import { message, type Message } from "./i18n/translate";
import { StartupPicker } from "./components/layout/StartupPicker";
import { StartupErrorScreen } from "./components/layout/StartupErrorScreen";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";
import { ToastHost } from "./components/shared/ToastHost";
import {
  describeAppStateRecovery,
  describeLoadFailure,
  describeNoteDraftRecovery,
} from "./services";

type AppPhase =
  | { kind: "loading" }
  | { kind: "startup" }
  | { kind: "error"; message: Message }
  | { kind: "main" };

function App() {
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const [mainChromeHeight, setMainChromeHeight] = useState(TAB_BAR_MIN_HEIGHT);
  const loadPreferences = usePreferencesStore((s) => s.load);
  const loadWorkspace = useWorkspaceStore((s) => s.load);
  const initializeAppState = useAppStateStore((s) => s.initialize);
  const loadNoteDrafts = useNoteDraftStore((s) => s.load);
  const setLastPaths = useAppStateStore((s) => s.setLastPaths);
  const theme = usePreferencesStore((s) => s.preferences.theme);
  const loadLanguageEnvironment = useLanguageStore((s) => s.load);
  const { language, locale } = useInterfaceLanguage();
  const fontFamily = usePreferencesStore((s) => s.preferences.fontFamily);
  // Guards against a double Launch: phase stays "startup" until the awaited
  // loads finish, so two quick clicks would otherwise both run the sequence.
  const launchingRef = useRef(false);

  // The window theme is the one theme authority: it paints the title bar, and
  // App.css's tokens follow it through prefers-color-scheme, which reaches the
  // startup picker, the main window, and every portaled Radix surface alike.
  // The Rust core already applied the last-launched document's theme before
  // showing the window, so nothing is sent while the app is still loading (or
  // failed to): the in-memory default would replace that choice with System.
  const themeSettled = phase.kind === "startup" || phase.kind === "main";
  useEffect(() => {
    if (!themeSettled) return;
    applyWindowTheme(theme).catch((e) =>
      log.warn("window theme apply failed", {
        theme,
        ...toErrorFields(e),
      }),
    );
  }, [themeSettled, theme]);

  // The native menu follows the interface language. The Rust core built it in
  // the last-launched document's language before the window was shown, and
  // skips a language it already has.
  useEffect(() => {
    if (!themeSettled) return;
    applyLanguage(language).catch((e) =>
      log.warn("native language apply failed", {
        language,
        ...toErrorFields(e),
      }),
    );
  }, [themeSettled, language]);

  // Set the UI font on <html> so it reaches every Radix surface, all of which
  // portal to <body> and sit outside the React tree. A family the user typed is appended to the default stack rather
  // than replacing it, so a typo falls back to a real sans face instead of the
  // engine's serif. Empty means "use the default".
  useEffect(() => {
    const chosen = fontFamily.trim();
    document.documentElement.style.setProperty(
      "--font-ui",
      chosen ? `${chosen}, ${DEFAULT_UI_FONT_STACK}` : DEFAULT_UI_FONT_STACK,
    );
  }, [fontFamily]);

  // Enforce the content-based minimum window size. Width is derived from the
  // pane minima; height is the usable-content floor plus the tab chrome's live
  // measured height. That measurement includes wrapped rows and a visible
  // persistent result strip, so chrome growth can never consume usable content.
  //
  // It is re-applied on every zoom change: the pane minimums are CSS pixels and
  // the OS minimum is logical ones, so a minimum computed once at 100% let a
  // zoomed-in window shrink to a fraction of what its content needs.
  const zoomLevel = useAppStateStore((s) => s.appState.zoomLevel);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const required = {
      width: computeMinWindowWidth(zoomLevel),
      height: computeMinWindowHeight(zoomLevel, mainChromeHeight),
    };
    const applyMinimum = async () => {
      try {
        const [maximized, fullscreen, minimized] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
          appWindow.isMinimized(),
        ]);
        if (maximized || fullscreen || minimized) return;
        const monitor = await currentMonitor();
        let minimum = required;
        if (monitor !== null) {
          const [outer, inner] = await Promise.all([
            appWindow.outerSize(),
            appWindow.innerSize(),
          ]);
          const scale = monitor.scaleFactor || 1;
          minimum = boundNativeMinimumToClient(required, {
            width: Math.floor(
              (monitor.workArea.size.width -
                Math.max(0, outer.width - inner.width)) /
                scale,
            ),
            height: Math.floor(
              (monitor.workArea.size.height -
                Math.max(0, outer.height - inner.height)) /
                scale,
            ),
          });
        }
        if (!disposed) {
          await appWindow.setMinSize(
            new LogicalSize(minimum.width, minimum.height),
          );
        }
      } catch (error) {
        log.warn("window setMinSize failed", {
          required,
          ...toErrorFields(error),
        });
      }
    };
    const retain = (registration: Promise<() => void>) => {
      void registration
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistens.push(unlisten);
        })
        .catch((error) =>
          log.warn("window metric listener failed", toErrorFields(error)),
        );
    };
    // On Windows, setMinSize during a maximize transition can interrupt the
    // transition and leave a work-area-sized normal window. Install geometry
    // listeners only after the initial minimum has settled.
    void applyMinimum().then(() => {
      if (disposed) return;
      retain(appWindow.onMoved(() => void applyMinimum()));
      retain(appWindow.onScaleChanged(() => void applyMinimum()));
    });
    return () => {
      disposed = true;
      for (const unlisten of unlistens) unlisten();
    };
  }, [zoomLevel, mainChromeHeight]);

  // Initialize on mount.
  useEffect(() => {
    (async () => {
      try {
        await loadLanguageEnvironment();
        const quarantinedTo = await initializeAppState();

        // The picker appears before the user chooses a preferences document,
        // so preview the last successfully opened one. This gives the initial
        // window that document's System/Light/Dark policy without duplicating
        // portable configuration into state.json. A missing or damaged former
        // selection naturally leaves the in-memory System default in place.
        const lastPreferencesPath =
          useAppStateStore.getState().appState.lastLaunchedPreferencesPath;
        if (lastPreferencesPath) {
          const previewResult = await loadPreferences(lastPreferencesPath);
          if (previewResult.status !== "success") {
            log.warn(
              "startup theme preferences load failed",
              loadFailureFields(lastPreferencesPath, previewResult),
            );
          }
        }
        setPhase({ kind: "startup" });
        if (quarantinedTo) {
          await showMessage(
            message("startup.appStateReset.title"),
            describeAppStateRecovery(quarantinedTo),
          );
        }
      } catch (e) {
        log.error("app initialization failed", toErrorFields(e));
        setPhase({
          kind: "error",
          message: message("startup.appStateFailed"),
        });
      }
    })();
  }, [initializeAppState, loadLanguageEnvironment, loadPreferences]);

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
          message("startup.preferencesFailed.title"),
          describeLoadFailure("preferences", preferencesResult, preferencesPath),
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
          message("startup.workspaceFailed.title"),
          describeLoadFailure("workspace", workspaceResult, workspacePath),
        );
        return;
      }

      // Remember only a successfully loaded selection.
      await setLastPaths(preferencesPath, workspacePath);

      // Note drafts — the user's uncommitted note text, written through as they
      // type. App-level like state.json, not part of the portable documents
      // just loaded, so it is read here rather than alongside either of them.
      const draftsQuarantinedTo = await loadNoteDrafts();

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

      if (draftsQuarantinedTo) {
        await showMessage(
          message("startup.draftsReset.title"),
          describeNoteDraftRecovery(draftsQuarantinedTo),
        );
      }
    } finally {
      // On failure, allow a retry; on success the picker unmounts so this is moot.
      launchingRef.current = false;
    }
  };

  let content: ReactNode;

  switch (phase.kind) {
    case "loading":
      // No text until the language is known, so the first words on screen are
      // already in it.
      content = <div className="h-screen bg-background" />;
      break;

    case "error":
      content = <StartupErrorScreen message={phase.message} />;
      break;

    case "startup":
      content = <StartupPicker onLaunch={handleLaunch} />;
      break;

    case "main":
      content = <MainWindow onChromeHeightChange={setMainChromeHeight} />;
      break;
  }

  return (
    <I18nProvider language={language} locale={locale}>
      {content}
      <AppDialogHost />
      <ToastHost />
    </I18nProvider>
  );
}



export default App;
