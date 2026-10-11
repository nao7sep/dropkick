// App root: restore the last successful pair, or guide setup/recovery.
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
  loadFailureFields,
} from "./repositories";
import { DEFAULT_UI_FONT_STACK } from "./models";
import { usePreferencesStore } from "./state/preferences-store";
import { useAppConfigStore } from "./state/app-config-store";
import { useAppStateStore } from "./state/app-state-store";
import { useLanguageStore } from "./state/language-store";
import { currentInterfaceLanguage, useInterfaceLanguage } from "./hooks/useInterfaceLanguage";
import { I18nProvider, loadInterfaceCatalogue } from "./i18n/I18nContext";
import { message, type Message } from "./i18n/translate";
import { useWindowClose } from "./hooks/use-window-close";
import { openSession } from "./services/open-session";
import { FirstRunSetup } from "./components/layout/FirstRunSetup";
import { StartupPicker } from "./components/layout/StartupPicker";
import { StartupErrorScreen } from "./components/layout/StartupErrorScreen";
import { MainWindow } from "./components/layout/MainWindow";
import { AppDialogHost } from "./components/shared/AppDialogHost";
import { ToastHost } from "./components/shared/ToastHost";
import {
  describeAppConfigRecovery,
  describeLoadFailure,
} from "./services";

type AppPhase =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "startup"; returnTo?: "main" | "setup" }
  | { kind: "error"; message: Message }
  | { kind: "main" };

function App() {
  useWindowClose();
  const [phase, setPhase] = useState<AppPhase>({ kind: "loading" });
  const [startupNotices, setStartupNotices] = useState<Array<{ title: Message; body: Message }>>([]);
  const [mainChromeHeight, setMainChromeHeight] = useState(TAB_BAR_MIN_HEIGHT);
  const loadPreferences = usePreferencesStore((s) => s.load);
  const initializeAppConfig = useAppConfigStore((s) => s.initialize);
  const initializeAppState = useAppStateStore((s) => s.initialize);
  const setLastPaths = useAppStateStore((s) => s.setLastPaths);
  const theme = usePreferencesStore((s) => s.preferences.theme);
  const loadLanguageEnvironment = useLanguageStore((s) => s.load);
  const { language, locale } = useInterfaceLanguage();
  const fontFamily = usePreferencesStore((s) => s.preferences.fontFamily);
  // Guards against a double Launch: phase stays "startup" until the awaited
  // loads finish, so two quick clicks would otherwise both run the sequence.
  const launchingRef = useRef(false);
  const initializedRef = useRef(false);

  // The window theme is the one theme authority: it paints the title bar, and
  // App.css's tokens follow it through prefers-color-scheme, which reaches the
  // startup picker, the main window, and every portaled Radix surface alike.
  // The Rust core already applied the last-launched document's theme before
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
  // not adopt an old pair after the first pass has shown an editable session.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    (async () => {
      // Which store a failure leaves unread, so its message names the right one.
      let failure: "startup.appStateFailed" | "startup.appConfigFailed" = "startup.appStateFailed";
      try {
        await loadLanguageEnvironment();
        await initializeAppState();
        failure = "startup.appConfigFailed";
        const configRecovery = await initializeAppConfig();
        failure = "startup.appStateFailed";

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
        // The first text on screen is already in the interface language.
        await loadInterfaceCatalogue(currentInterfaceLanguage());
        const notices: Array<{ title: Message; body: Message }> = [];
        const state = useAppStateStore.getState().appState;
        if (lastPreferencesPath && state.lastWorkspacePath) {
          const opened = await openSession(lastPreferencesPath, state.lastWorkspacePath);
          if (opened.kind === "success") setPhase({ kind: "main" });
          else {
            setPhase({ kind: "startup" });
            if (opened.kind !== "save") notices.push({
              title: message(opened.kind === "preferences" ? "startup.preferencesFailed.title" : "startup.workspaceFailed.title"),
              body: describeLoadFailure(opened.kind, opened.failure, opened.kind === "preferences" ? lastPreferencesPath : state.lastWorkspacePath),
            });
          }
        } else {
          const config = useAppConfigStore.getState().appConfig;
          setPhase({ kind: config.knownPreferences.length || config.knownWorkspaces.length ? "startup" : "setup" });
        }
        if (configRecovery) {
          const notice = describeAppConfigRecovery(configRecovery);
          notices.push(notice);
        }
        setStartupNotices(notices);
      } catch (e) {
        log.error("app initialization failed", toErrorFields(e));
        await loadInterfaceCatalogue(currentInterfaceLanguage());
        setPhase({
          kind: "error",
          message: message(failure),
        });
      }
    })();
  }, [initializeAppState, initializeAppConfig, loadLanguageEnvironment, loadPreferences]);

  const handleLaunch = async (
    preferencesPath: string,
    workspacePath: string,
  ) => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    try {
      const opened = await openSession(preferencesPath, workspacePath);
      if (opened.kind === "save") {
        await showMessage(message("startup.workspaceFailed.title"), message("write.openTabs"));
        return;
      }
      if (opened.kind !== "success") {
        await showMessage(
          message(opened.kind === "preferences" ? "startup.preferencesFailed.title" : "startup.workspaceFailed.title"),
          describeLoadFailure(opened.kind, opened.failure, opened.kind === "preferences" ? preferencesPath : workspacePath),
        );
        return;
      }
      await setLastPaths(preferencesPath, workspacePath);
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

    case "error":
      content = <StartupErrorScreen message={phase.message} />;
      break;

    case "setup":
      content = <FirstRunSetup onLaunch={handleLaunch} onExisting={() => setPhase({ kind: "startup", returnTo: "setup" })} onQuit={quit} />;
      break;

    case "startup":
      content = <StartupPicker onLaunch={handleLaunch} onQuit={quit}
        onCancel={phase.returnTo ? () => { if (!launchingRef.current) setPhase({ kind: phase.returnTo! }); } : undefined} />;
      break;

    case "main":
      content = <MainWindow onChromeHeightChange={setMainChromeHeight} onSwitchDocuments={() => setPhase({ kind: "startup", returnTo: "main" })} />;
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
