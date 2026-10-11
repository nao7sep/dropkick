// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { mount, type Mounted } from "./helpers/react-dom";
const mocks = vi.hoisted(() => ({ state: { lastLaunchedPreferencesPath: "", lastWorkspacePath: "", zoomLevel: 1 }, config: { knownPreferences: [] as string[], knownWorkspaces: [] as string[] }, preview: vi.fn(async () => ({ status: "success" })), open: vi.fn(), paths: vi.fn(), close: vi.fn(), init: vi.fn(async () => null) }));
vi.mock("../src/hooks/use-window-close", () => ({ useWindowClose: vi.fn() }));
vi.mock("../src/services/open-session", () => ({ openSession: mocks.open }));
vi.mock("../src/hooks/useInterfaceLanguage", () => ({ currentInterfaceLanguage: () => "en", useInterfaceLanguage: () => ({ language: "en", locale: "en-US" }) }));
vi.mock("../src/state/preferences-store", () => ({ usePreferencesStore: (select: (state: unknown) => unknown) => select({ load: mocks.preview, preferences: { theme: "system", fontFamily: "" } }) }));
vi.mock("../src/state/app-state-store", () => ({ useAppStateStore: Object.assign((select: (state: unknown) => unknown) => select({ initialize: mocks.init, setLastPaths: mocks.paths, appState: mocks.state }), { getState: () => ({ appState: mocks.state }) }) }));
vi.mock("../src/state/app-config-store", () => ({ useAppConfigStore: Object.assign((select: (state: unknown) => unknown) => select({ initialize: mocks.init }), { getState: () => ({ appConfig: mocks.config }) }) }));
vi.mock("../src/state/language-store", () => ({ useLanguageStore: (select: (state: unknown) => unknown) => select({ load: mocks.init }) }));
vi.mock("../src/repositories", () => ({ applyLanguage: async () => {}, applyWindowTheme: async () => {}, showMessage: async () => {}, log: { warn: vi.fn(), error: vi.fn() }, toErrorFields: () => ({}), loadFailureFields: () => ({}) }));
vi.mock("@tauri-apps/api/window", () => ({ LogicalSize: class {}, currentMonitor: async () => null, getCurrentWindow: () => ({ isMaximized: async () => true, isFullscreen: async () => false, isMinimized: async () => false, onMoved: async () => () => {}, onScaleChanged: async () => () => {}, close: mocks.close }) }));
vi.mock("../src/components/layout/FirstRunSetup", () => ({ FirstRunSetup: ({ onExisting }: { onExisting: () => void }) => createElement("button", { onClick: onExisting }, "Setup") }));
vi.mock("../src/components/layout/StartupPicker", () => ({ StartupPicker: ({ onCancel, onLaunch }: { onCancel?: () => void; onLaunch: (p: string, w: string) => void }) => createElement("div", null, "Picker", createElement("button", { onClick: onCancel }, "Cancel"), createElement("button", { onClick: () => onLaunch("new-p", "new-w") }, "Open")) }));
vi.mock("../src/components/layout/MainWindow", () => ({ MainWindow: ({ onSwitchDocuments }: { onSwitchDocuments: () => void }) => createElement("button", { onClick: onSwitchDocuments }, "Main") }));
vi.mock("../src/components/shared/AppDialogHost", () => ({ AppDialogHost: () => null }));
vi.mock("../src/components/shared/ToastHost", () => ({ ToastHost: () => null }));
import App from "../src/App";
let host: Mounted;
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.lastLaunchedPreferencesPath = ""; mocks.state.lastWorkspacePath = "";
  mocks.config.knownPreferences = []; mocks.config.knownWorkspaces = [];
  mocks.open.mockResolvedValue({ kind: "success" });
  mocks.init.mockResolvedValue(null);
});
afterEach(async () => { await host?.unmount(); });
const click = async (label: string) => { await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click(); }); };
describe("startup routing", () => {
  it("shows setup on a fresh launch and returns from browsing without writes", async () => {
    host = await mount(createElement(App));
    expect(document.body.textContent).toBe("Setup");
    await click("Setup"); await click("Cancel");
    expect(document.body.textContent).toBe("Setup");
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.paths).not.toHaveBeenCalled();
  });
  it("reopens the successful pair directly and cancelling an explicit switch keeps it", async () => {
    mocks.state.lastLaunchedPreferencesPath = "old-p"; mocks.state.lastWorkspacePath = "old-w";
    host = await mount(createElement(App));
    expect(mocks.open).toHaveBeenCalledWith("old-p", "old-w");
    expect(document.body.textContent).toBe("Main");
    await click("Main"); await click("Cancel");
    expect(document.body.textContent).toBe("Main");
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it("returns a missing former document to the picker without remembering a replacement", async () => {
    mocks.state.lastLaunchedPreferencesPath = "old-p"; mocks.state.lastWorkspacePath = "missing-w";
    mocks.open.mockResolvedValue({ kind: "workspace", failure: { status: "missing" } });
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("Picker");
    expect(mocks.paths).not.toHaveBeenCalled();
  });
  it("records a new pair only after it successfully opens", async () => {
    mocks.config.knownWorkspaces = ["known"];
    host = await mount(createElement(App));
    await click("Open");
    expect(mocks.paths).toHaveBeenCalledWith("new-p", "new-w");
    expect(document.body.textContent).toBe("Main");
  });
});
