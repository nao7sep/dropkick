// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const applyWindowTheme = vi.fn();
const setMinSize = vi.fn();
const show = vi.fn();
const isMaximized = vi.fn();
const isFullscreen = vi.fn();
const isMinimized = vi.fn();
const onMoved = vi.fn();
const onScaleChanged = vi.fn();

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
  showMessage: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: vi.fn(() => ({})),
  loadFailureFields: vi.fn(() => ({})),
  initializeAppState: vi.fn(),
  flushAppState: vi.fn(),
  loadPreferences: vi.fn(),
  flushPreferences: vi.fn(),
}));

vi.mock("../src/components/layout/StartupPicker", () => ({
  StartupPicker: () => "Startup picker",
}));
vi.mock("../src/components/layout/StartupErrorScreen", () => ({
  StartupErrorScreen: () => "Startup error",
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
import { createDefaultAppState, createDefaultPreferences } from "../src/models";
import type { ThemePreference } from "../src/models";
import { useAppStateStore } from "../src/state/app-state-store";
import { usePreferencesStore } from "../src/state/preferences-store";
import { mount } from "./helpers/react-dom";
import type { Mounted } from "./helpers/react-dom";

const LAST_PREFERENCES = "/last-preferences.json";
let host: Mounted;
let loadedTheme: ThemePreference;
let lastLaunchedPreferencesPath: string;

beforeEach(() => {
  applyWindowTheme.mockReset().mockResolvedValue(undefined);
  setMinSize.mockReset().mockResolvedValue(undefined);
  show.mockReset().mockResolvedValue(undefined);
  isMaximized.mockReset().mockResolvedValue(false);
  isFullscreen.mockReset().mockResolvedValue(false);
  isMinimized.mockReset().mockResolvedValue(false);
  onMoved.mockReset().mockResolvedValue(() => {});
  onScaleChanged.mockReset().mockResolvedValue(() => {});
  loadedTheme = "dark";
  lastLaunchedPreferencesPath = LAST_PREFERENCES;
  const appState = {
    ...createDefaultAppState(),
    lastPreferencesPath: LAST_PREFERENCES,
    lastLaunchedPreferencesPath,
  };
  const initialize = vi.fn(async () => {
    useAppStateStore.setState({
      appState: { ...appState, lastLaunchedPreferencesPath },
      loaded: true,
    });
    return null;
  });
  useAppStateStore.setState({ appState, initialize, loaded: false });

  const load = vi.fn(async (filePath: string) => {
    const preferences = {
      ...createDefaultPreferences("Last"),
      theme: loadedTheme,
    };
    usePreferencesStore.setState({ preferences, filePath, loaded: true });
    return { status: "success" as const, preferences };
  });
  usePreferencesStore.setState({
    preferences: createDefaultPreferences("Default"),
    filePath: "",
    loaded: false,
    load,
  });
});

afterEach(async () => {
  await host.unmount();
});

async function mountApp() {
  host = await mount(createElement(App));
  await act(async () => {
    await Promise.resolve();
  });
}

// The Rust core applies the previewed document's theme before the window is
// shown; the page re-applies only once it knows the same answer.
describe("startup theme", () => {
  it("applies System when no preferences document has launched the main window", async () => {
    lastLaunchedPreferencesPath = "";
    await mountApp();

    expect(usePreferencesStore.getState().load).not.toHaveBeenCalled();
    expect(applyWindowTheme.mock.calls).toEqual([["system"]]);
  });

  it("applies the previewed document's theme, never the pre-load default", async () => {
    await mountApp();

    expect(usePreferencesStore.getState().load).toHaveBeenCalledWith(
      LAST_PREFERENCES,
    );
    expect(document.body.textContent).toContain("Startup picker");
    expect(applyWindowTheme.mock.calls).toEqual([["dark"]]);
  });

  it("sends nothing while initialization is still running", async () => {
    useAppStateStore.setState({ initialize: vi.fn(() => new Promise<null>(() => {})) });
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

    expect(document.body.textContent).toContain("Startup error");
    expect(applyWindowTheme).not.toHaveBeenCalled();
  });

  it("applies a changed theme once the app is running", async () => {
    await mountApp();
    await act(async () => {
      const { preferences } = usePreferencesStore.getState();
      usePreferencesStore.setState({ preferences: { ...preferences, theme: "light" } });
    });

    expect(applyWindowTheme).toHaveBeenLastCalledWith("light");
  });
});
