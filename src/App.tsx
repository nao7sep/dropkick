// App root: restore the last workspace, or show the workspace list.
// Session drafts remain in their stores when the document picker replaces the view.

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
} from "./repositories";
import { DEFAULT_UI_FONT_STACK } from "./models";
import { usePreferencesStore } from "./state/preferences-store";
import { useAppConfigStore } from "./state/app-config-store";
import { useAppStateStore } from "./state/app-state-store";
import { useLanguageStore } from "./state/language-store";
import { currentInterfaceLanguage, useInterfaceLanguage } from "./hooks/useInterfaceLanguage";
import { I18nProvider, loadInterfaceCatalogue } from "./i18n/I18nContext";
import { message, type Message } from "./i18n/translate";
import { useRecordsWindowSync } from "./hooks/useRecordsWindow";
import { StartupLoadingScreen } from "./components/layout/StartupLoadingScreen";
import { useWindowClose } from "./hooks/use-window-close";
import { openWorkspaceSession } from "./services/open-workspace-session";
import { StartupPicker } from "./components/layout/StartupPicker";
import { StartupErrorScreen } from "./components/layout/StartupErrorScreen";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";
import { ToastHost } from "./components/shared/ToastHost";
import {
  describeAppConfigRecovery,
  describeLoadFailure,
} from "./services";

type StartupNotice = { title: Message; body: Message };

type AppPhase =
  | { kind: "loading" }
  | { kind: "opening"; path: string; notices: StartupNotice[] }
  | { kind: "startup"; returnTo?: "main" }
  | { kind: "error"; message: Message }
  | { kind: "main" };

function App() {
  useWindowClose();
  useRecordsWindowSync();
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const [startupNotices, setStartupNotices] = useState<StartupNotice[]>([]);
  const [mainChromeHeight, setMainChromeHeight] = useState(TAB_BAR_MIN_HEIGHT);
  const initializePreferences = usePreferencesStore((s) => s.initialize);
  const initializeAppConfig = useAppConfigStore((s) => s.initialize);
  const initializeAppState = useAppStateStore((s) => s.initialize);
  const setLastWorkspace = useAppStateStore((s) => s.setLastWorkspace);
  const theme = usePreferencesStore((s) => s.preferences.theme);
  const loadLanguageEnvironment = useLanguageStore((s) => s.load);
  const { language, locale } = useInterfaceLanguage();
  const fontFamily = usePreferencesStore((s) => s.preferences.fontFamily);
  // Guards against a double Launch: phase stays "startup" until the awaited
  // loads finish, so two quick clicks would otherwise both run the sequence.
  const launchingRef = useRef(false);
  const initializedRef = useRef(false);
  const startupAttemptRef = useRef<{ active: boolean } | null>(null);

  // The window theme is the one theme authority: it paints the title bar, and
  // App.css's tokens follow it through prefers-color-scheme, which reaches the
  // startup picker, the main window, and every portaled Radix surface alike.
  // The Rust core already applied the app-wide settings' theme before
  // showing the window, so nothing is sent while the app is still loading (or
  // failed to): the in-memory default would replace that choice with System.
  const themeSettled = phase.kind !== "loading" && phase.kind !== "error";
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
  // the app-wide settings' language before the window was shown, and
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

  // Mount the recovery picker before its message. Mounting two Radix focus
  // scopes in the same commit can hide the message's title/body from AX.
  useEffect(() => {
    if (startupNotices.length === 0) return;
    setStartupNotices([]);
    void (async () => {
      for (const notice of startupNotices) await showMessage(notice.title, notice.body);
    })().catch((error) => log.error("startup notice failed", toErrorFields(error)));
  }, [startupNotices]);

  // One initialization also in development StrictMode: its effect replay must
  // not adopt an old workspace after the first pass has shown an editable session.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      // Which store a failure leaves unread, so its message names the right one.
      let failure: "startup.appStateFailed" | "startup.appConfigFailed" = "startup.appStateFailed";
      try {
        await loadLanguageEnvironment();
        const preferences = await initializePreferences();
        if (preferences.status !== "success") {
          await loadInterfaceCatalogue(currentInterfaceLanguage());
          setPhase({ kind: "error", message: describeLoadFailure("preferences", preferences, preferences.filePath) });
          return;
        }
        await initializeAppState();
        failure = "startup.appConfigFailed";
        const configRecovery = await initializeAppConfig();
        // The first text on screen is already in the interface language.
        await loadInterfaceCatalogue(currentInterfaceLanguage());
        const notices: StartupNotice[] = [];
        if (configRecovery) notices.push(describeAppConfigRecovery(configRecovery));
        const state = useAppStateStore.getState().appState;
        if (state.lastWorkspacePath) {
          const attempt = { active: true };
          startupAttemptRef.current = attempt;
          setPhase({ kind: "opening", path: state.lastWorkspacePath, notices });
          const opened = await openWorkspaceSession(state.lastWorkspacePath, () => attempt.active);
          if (!attempt.active || opened.kind === "abandoned") return;
          if (opened.kind === "success") setPhase({ kind: "main" });
          else {
            setPhase({ kind: "startup" });
            if (opened.kind === "workspace") notices.push({
              title: message("startup.workspaceFailed.title"),
              body: describeLoadFailure(opened.kind, opened.failure, state.lastWorkspacePath),
            });
          }
        } else {
          setPhase({ kind: "startup" });
        }
        if (notices.length) setStartupNotices(notices);
      } catch (e) {
        if (startupAttemptRef.current?.active === false) return;
        log.error("app initialization failed", toErrorFields(e));
        await loadInterfaceCatalogue(currentInterfaceLanguage());
        setPhase({
          kind: "error",
          message: message(failure),
        });
      }
    })();
  }, [initializeAppState, initializeAppConfig, loadLanguageEnvironment, initializePreferences]);

  const handleLaunch = async (
    workspacePath: string,
  ) => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    try {
      const opened = await openWorkspaceSession(workspacePath);
      if (opened.kind === "abandoned") return;
      if (opened.kind === "tasks") {
        setPhase({ kind: "main" });
        await showMessage(message("startup.workspaceFailed.title"), message("tabs.notSaved", { path: opened.paths.join("\n") }));
        return;
      }
      if (opened.kind === "save") {
        await showMessage(message("startup.workspaceFailed.title"), message("write.openTabs"));
        return;
      }
      if (opened.kind !== "success") {
        await showMessage(
          message("startup.workspaceFailed.title"),
          describeLoadFailure(opened.kind, opened.failure, workspacePath),
        );
        return;
      }
      // Remembering the last choice is disposable state, not session admission.
      void setLastWorkspace(workspacePath);
      await loadInterfaceCatalogue(currentInterfaceLanguage());
      setPhase({ kind: "main" });
    } catch (error) {
      log.error("open session failed", toErrorFields(error));
      await showMessage(message("startup.workspaceFailed.title"), message("startup.openWorkspaceFailed.body"));
    } finally {
      launchingRef.current = false;
    }
  };
  const quit = () => {
    void getCurrentWindow().close().catch((error) => log.warn("quit request failed", toErrorFields(error)));
  };

  let content: ReactNode;

  switch (phase.kind) {
    case "loading":
      // No text until the language is known, so the first words on screen are
      // already in it.
      content = <div className="h-screen bg-background" />;
      break;

    case "opening":
      content = <StartupLoadingScreen path={phase.path} onChooseAnother={() => {
        if (startupAttemptRef.current) startupAttemptRef.current.active = false;
        setStartupNotices(phase.notices);
        setPhase({ kind: "startup" });
      }} />;
      break;

    case "error":
      content = <StartupErrorScreen message={phase.message} />;
      break;

    case "startup":
      content = <StartupPicker onLaunch={handleLaunch} onQuit={quit}
        onCancel={phase.returnTo ? () => { if (!launchingRef.current) setPhase({ kind: phase.returnTo! }); } : undefined} />;
      break;

    case "main":
      content = <MainWindow onChromeHeightChange={setMainChromeHeight} onSwitchWorkspace={() => setPhase({ kind: "startup", returnTo: "main" })} />;
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
