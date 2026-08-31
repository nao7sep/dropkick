// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
const setMinSize = vi.fn();
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
    setTheme,
    setMinSize,
    onMoved,
    onScaleChanged,
  }),
}));

vi.mock("../src/repositories", () => ({
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
  setTheme.mockReset().mockResolvedValue(undefined);
  setMinSize.mockReset().mockResolvedValue(undefined);
  onMoved.mockReset().mockResolvedValue(() => {});
  onScaleChanged.mockReset().mockResolvedValue(() => {});
  loadedTheme = "dark";
  lastLaunchedPreferencesPath = LAST_PREFERENCES;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

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
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("startup theme", () => {
  it("uses the OS when no preferences document has launched the main window", async () => {
    lastLaunchedPreferencesPath = "";
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    host = await mount(createElement(App));
    await act(async () => {
      await Promise.resolve();
    });

    expect(usePreferencesStore.getState().load).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(setTheme).toHaveBeenLastCalledWith(null);
  });

  it("loads the last preferences theme before showing the startup picker", async () => {
    host = await mount(createElement(App));
    await act(async () => {
      await Promise.resolve();
    });

    expect(usePreferencesStore.getState().load).toHaveBeenCalledWith(
      LAST_PREFERENCES,
    );
    expect(document.body.textContent).toContain("Startup picker");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(setTheme).toHaveBeenLastCalledWith("dark");
  });

  it("lets the OS own native chrome while System controls the startup picker", async () => {
    loadedTheme = "system";
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    host = await mount(createElement(App));
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(setTheme).toHaveBeenLastCalledWith(null);
  });
});
