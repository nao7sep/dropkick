// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applyWindowTheme = vi.fn();
const applyLanguage = vi.fn();
const loadLanguageEnvironment = vi.fn();
const setMinSize = vi.fn();
const show = vi.fn();
const isMaximized = vi.fn();
const isFullscreen = vi.fn();
const isMinimized = vi.fn();
const onMoved = vi.fn();
const onScaleChanged = vi.fn();
const pickerLanguages = vi.hoisted((): string[] => []);

vi.mock("../src/hooks/use-window-close", () => ({ useWindowClose: vi.fn() }));

vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  currentMonitor: vi.fn().mockResolvedValue(null),
  getCurrentWindow: () => ({
    setMinSize,
    show,
    isMaximized,
    isFullscreen,
    isMinimized,
    onMoved,
    onScaleChanged,
  }),
}));

vi.mock("../src/repositories", () => ({
  applyWindowTheme: (...args: unknown[]) => applyWindowTheme(...args),
  applyLanguage: (...args: unknown[]) => applyLanguage(...args),
  loadLanguageEnvironment: (...args: unknown[]) => loadLanguageEnvironment(...args),
  showMessage: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: vi.fn(() => ({})),
  loadFailureFields: vi.fn(() => ({})),
  initializeAppState: vi.fn(),
  flushAppState: vi.fn(),
  loadSettings: vi.fn(),
  flushSettings: vi.fn(),
}));

vi.mock("../src/components/layout/StartupPicker", async () => {
  const { useI18n } = await import("../src/i18n/I18nContext");
  return {
    StartupPicker: () => {
      pickerLanguages.push(useI18n().language);
      return "Startup picker";
    },
  };
});
vi.mock("../src/components/layout/StartupErrorScreen", () => ({
  // Names which message it was given without putting a raw catalogue key on screen.
  StartupErrorScreen: ({ message }: { message: { key: string } }) =>
    `Startup error: ${message.key.replace(/^startup\./, "").replace(/Failed$/, "")}`,
}));
vi.mock("../src/components/layout/MainWindow", () => ({
  MainWindow: () => "Main window",
}));
vi.mock("../src/components/shared/AppDialogHost", () => ({
  AppDialogHost: () => null,
}));
vi.mock("../src/components/shared/ToastHost", () => ({
  ToastHost: () => null,
}));

import App from "../src/App";
import { createDefaultAppState, createDefaultSettings } from "../src/models";
import type { ThemePreference } from "../src/models";
import { loadCatalogue } from "../src/i18n/catalogues";
import type { LanguagePreference } from "../src/i18n/languages";
import { currentInterfaceLanguage } from "../src/hooks/useInterfaceLanguage";
import { useLanguageStore } from "../src/state/language-store";
import { useAppConfigStore } from "../src/state/app-config-store";
import { useAppStateStore } from "../src/state/app-state-store";
import { useSettingsStore } from "../src/state/settings-store";
import { mount } from "./helpers/react-dom";
import type { Mounted } from "./helpers/react-dom";

const LAST_SETTINGS = "/last-settings.json";
let host: Mounted;
let loadedTheme: ThemePreference;
let loadedLanguage: LanguagePreference;


beforeEach(() => {
  applyWindowTheme.mockReset().mockResolvedValue(undefined);
  applyLanguage.mockReset().mockResolvedValue(undefined);
  loadLanguageEnvironment.mockReset().mockResolvedValue({ systemLanguage: "ja", systemLocale: "ja-JP" });
  useLanguageStore.setState({ systemLanguage: "en", systemLocale: null });
  loadedLanguage = "system";
  pickerLanguages.length = 0;
  setMinSize.mockReset().mockResolvedValue(undefined);
  show.mockReset().mockResolvedValue(undefined);
  isMaximized.mockReset().mockResolvedValue(false);
  isFullscreen.mockReset().mockResolvedValue(false);
  isMinimized.mockReset().mockResolvedValue(false);
  onMoved.mockReset().mockResolvedValue(() => {});
  onScaleChanged.mockReset().mockResolvedValue(() => {});
  loadedTheme = "dark";
  const appState = {
    ...createDefaultAppState(),
  };
  const initialize = vi.fn(async () => {
    useAppStateStore.setState({
      appState: appState,
      loaded: true,
    });
  });
  useAppStateStore.setState({ appState, initialize, loaded: false });
  useAppConfigStore.setState({ initialize: vi.fn().mockResolvedValue(null), appConfig: { knownWorkspaces: ["/workspace.json"] } });

  const initializeSettings = vi.fn(async () => {
    const filePath = LAST_SETTINGS;
    const settings = {
      ...createDefaultSettings(),
      theme: loadedTheme,
      language: loadedLanguage,
    };
    useSettingsStore.setState({ settings, filePath, loaded: true });
    return { status: "success" as const, settings, filePath };
  });
  useSettingsStore.setState({
    settings: createDefaultSettings(),
    filePath: "",
    loaded: false,
    initialize: initializeSettings,
  });
});

afterEach(async () => {
  await host.unmount();
});

// Lets initialization reach the interface language's catalogue load, waits
// that load out, then the work queued behind it.
async function mountApp() {
  host = await mount(createElement(App));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await loadCatalogue(currentInterfaceLanguage());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The Rust core applies the app-wide theme before the window is
// shown; the page re-applies only once it knows the same answer.
describe("startup theme", () => {
  it("applies System when the app settings use System", async () => {
    loadedTheme = "system";
    await mountApp();

    expect(useSettingsStore.getState().initialize).toHaveBeenCalledOnce();
    expect(applyWindowTheme.mock.calls).toEqual([["system"]]);
  });

  it("applies the app-wide theme, never the pre-load default", async () => {
    await mountApp();

    expect(useSettingsStore.getState().initialize).toHaveBeenCalledWith();
    expect(document.body.textContent).toContain("Startup picker");
    expect(applyWindowTheme.mock.calls).toEqual([["dark"]]);
  });

  it("sends nothing while initialization is still running", async () => {
    useAppStateStore.setState({ initialize: vi.fn(() => new Promise<void>(() => {})) });
    await mountApp();

    expect(applyWindowTheme).not.toHaveBeenCalled();
  });

  it("leaves the natively applied theme alone when initialization fails", async () => {
    useAppStateStore.setState({
      initialize: vi.fn(async () => {
        throw new Error("state unreadable");
      }),
    });
    await mountApp();

    expect(document.body.textContent).toContain("Startup error: appState");
    expect(applyWindowTheme).not.toHaveBeenCalled();
  });

  it("names the saved locations when they are what could not be read", async () => {
    useAppConfigStore.setState({
      initialize: vi.fn(async () => {
        throw new Error("config unreadable");
      }),
    });
    await mountApp();

    expect(document.body.textContent).toContain("Startup error: appConfig");
  });

  it("applies a changed theme once the app is running", async () => {
    await mountApp();
    await act(async () => {
      const { settings } = useSettingsStore.getState();
      useSettingsStore.setState({ settings: { ...settings, theme: "light" } });
    });

    expect(applyWindowTheme).toHaveBeenLastCalledWith("light");
  });
});

// The native menu speaks the interface language: the previewed document's
// choice, with System resolved to the computer's language.
describe("startup language", () => {
  it("resolves System to the computer's language for the page and the native menu", async () => {
    await mountApp();

    expect(applyLanguage.mock.calls).toEqual([["ja"]]);
    expect(document.documentElement.lang).toBe("ja");
  });

  it("applies the previewed document's own language", async () => {
    loadedLanguage = "ru";
    await mountApp();

    expect(applyLanguage.mock.calls).toEqual([["ru"]]);
    expect(document.documentElement.lang).toBe("ru");
  });

  it("shows the startup picker in the interface language from its first render", async () => {
    loadedLanguage = "ko";
    await mountApp();

    expect(pickerLanguages.length).toBeGreaterThan(0);
    expect(new Set(pickerLanguages)).toEqual(new Set(["ko"]));
  });

  it("sends nothing while initialization is still running", async () => {
    useAppStateStore.setState({ initialize: vi.fn(() => new Promise<void>(() => {})) });
    await mountApp();

    expect(applyLanguage).not.toHaveBeenCalled();
  });

  it("applies a changed language once the app is running", async () => {
    await mountApp();
    await act(async () => {
      const { settings } = useSettingsStore.getState();
      useSettingsStore.setState({ settings: { ...settings, language: "de" } });
    });

    expect(applyLanguage).toHaveBeenLastCalledWith("de");
  });
});
