// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, act } from "react";
import { mount, type Mounted } from "./helpers/react-dom";
const mocks = vi.hoisted(() => ({ state: { lastWorkspacePath: "", zoomLevel: 1 }, config: { knownWorkspaces: [] as string[] }, preview: vi.fn<() => Promise<{ status: string; filePath?: string }>>(), open: vi.fn(), paths: vi.fn(), close: vi.fn(), init: vi.fn(async () => null), stateInit: vi.fn(async (): Promise<{ path: string; reason: string } | null> => null), configInit: vi.fn(async (): Promise<{ path: string; reason: string } | null> => null), refusals: vi.fn(async () => [] as unknown[]), stop: vi.fn(async () => {}), message: vi.fn(async () => {}) }));
vi.mock("../src/hooks/useRecordsWindow", () => ({ useRecordsWindowSync: vi.fn() }));
vi.mock("../src/hooks/use-window-close", () => ({ useWindowClose: vi.fn() }));
vi.mock("../src/services/open-workspace-session", () => ({ openWorkspaceSession: mocks.open }));
vi.mock("../src/hooks/useInterfaceLanguage", () => ({ currentInterfaceLanguage: () => "en", useInterfaceLanguage: () => ({ language: "en", locale: "en-US" }) }));
vi.mock("../src/state/settings-store", () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ initialize: mocks.preview, settings: { theme: "system", fontFamily: "" } }) }));
vi.mock("../src/state/app-state-store", () => ({ useAppStateStore: Object.assign((select: (state: unknown) => unknown) => select({ initialize: mocks.stateInit, setLastWorkspace: mocks.paths, appState: mocks.state }), { getState: () => ({ appState: mocks.state }) }) }));
vi.mock("../src/state/app-config-store", () => ({ useAppConfigStore: Object.assign((select: (state: unknown) => unknown) => select({ initialize: mocks.configInit }), { getState: () => ({ appConfig: mocks.config }) }) }));
vi.mock("../src/state/language-store", () => ({ useLanguageStore: (select: (state: unknown) => unknown) => select({ load: mocks.init }) }));
vi.mock("../src/repositories", () => ({ applyLanguage: async () => {}, applyWindowTheme: async () => {}, showMessage: mocks.message, launchRefusals: mocks.refusals, stopLaunch: mocks.stop, log: { warn: vi.fn(), error: vi.fn() }, toErrorFields: () => ({}), loadFailureFields: () => ({}) }));
vi.mock("@tauri-apps/api/window", () => ({ LogicalSize: class {}, currentMonitor: async () => null, getCurrentWindow: () => ({ isMaximized: async () => true, isFullscreen: async () => false, isMinimized: async () => false, onMoved: async () => () => {}, onScaleChanged: async () => () => {}, close: mocks.close }) }));
vi.mock("../src/components/layout/StartupPicker", () => ({ StartupPicker: ({ onCancel, onLaunch }: { onCancel?: () => void; onLaunch: (w: string) => void }) => createElement("div", null, "Picker", createElement("button", { onClick: onCancel }, "Cancel"), createElement("button", { onClick: () => onLaunch("new-w") }, "Open")) }));
vi.mock("../src/components/layout/MainWindow", () => ({ MainWindow: ({ onSwitchWorkspace }: { onSwitchWorkspace: () => void }) => createElement("button", { onClick: onSwitchWorkspace }, "Main") }));
vi.mock("../src/components/shared/AppDialogHost", () => ({ AppDialogHost: () => null }));
vi.mock("../src/components/shared/ToastHost", () => ({ ToastHost: () => null }));
import App from "../src/App";
let host: Mounted;
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.lastWorkspacePath = "";
  mocks.paths.mockReset().mockResolvedValue(undefined);
  mocks.config.knownWorkspaces = [];
  mocks.open.mockResolvedValue({ kind: "success" });
  mocks.init.mockResolvedValue(null);
  mocks.stateInit.mockResolvedValue(null);
  mocks.configInit.mockResolvedValue(null);
  mocks.refusals.mockResolvedValue([]);
  mocks.preview.mockResolvedValue({ status: "success" });
});
afterEach(async () => { await host?.unmount(); });
const click = async (label: string) => { await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click(); }); };
describe("launch refusals", () => {
  it("stops the launch naming every refused file, newer or unreadable, and opens nothing", async () => {
    mocks.state.lastWorkspacePath = "old-w";
    mocks.preview.mockResolvedValue({ status: "newer", filePath: "/root/settings.json" });
    mocks.stateInit.mockResolvedValue({ path: "/root/state.json", reason: "newer" });
    mocks.configInit.mockResolvedValue({ path: "/root/config.json", reason: "unreadable" });
    mocks.refusals.mockResolvedValue([
      { file: "/root/window.json", reason: "newer", store: "windowPlacement" },
      { file: "/root/records.sqlite3", reason: "newer", store: "records" },
    ]);
    host = await mount(createElement(App));
    const text = document.body.textContent ?? "";
    for (const path of ["/root/settings.json", "/root/state.json", "/root/config.json", "/root/window.json", "/root/records.sqlite3"]) {
      expect(text).toContain(path);
    }
    expect(text).toContain("This file could not be read.");
    expect(text).toContain("This file was saved by a newer version of Dropkick.");
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.paths).not.toHaveBeenCalled();
  });

  it("keeps running with a notice when a side store cannot be read", async () => {
    mocks.refusals.mockResolvedValue([{ file: "/root/backups.sqlite3", reason: "unreadable", store: "backups" }]);
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("Picker");
    expect(mocks.stop).not.toHaveBeenCalled();
    await act(async () => {});
    expect(mocks.message).toHaveBeenCalledWith(
      expect.objectContaining({ key: "startup.backupsOff.title" }),
      expect.objectContaining({ key: "startup.backupsOff.body", values: { path: "/root/backups.sqlite3" } }),
    );
  });
});

describe("startup routing", () => {
  it("shows an opened workspace while its optional remembered-location save remains pending", async () => {
    mocks.config.knownWorkspaces = ["known"];
    let release!: () => void;
    mocks.paths.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    host = await mount(createElement(App));
    try {
      await click("Open");
      expect(mocks.paths).toHaveBeenCalledWith("new-w");
      expect(document.body.textContent).toBe("Main");
    } finally { await act(async () => release()); }
  });
  it("shows the workspace list on a fresh launch, writing nothing until one opens", async () => {
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("Picker");
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.paths).not.toHaveBeenCalled();
  });
  it("reopens the last workspace directly and cancelling an explicit switch keeps it", async () => {
    mocks.state.lastWorkspacePath = "old-w";
    host = await mount(createElement(App));
    expect(mocks.open).toHaveBeenCalledWith("old-w", expect.any(Function));
    expect(document.body.textContent).toBe("Main");
    await click("Main"); await click("Cancel");
    expect(document.body.textContent).toBe("Main");
    expect(mocks.open).toHaveBeenCalledOnce();
  });
  it("returns a missing former document to the picker without remembering a replacement", async () => {
    mocks.state.lastWorkspacePath = "missing-w";
    mocks.open.mockResolvedValue({ kind: "workspace", failure: { status: "missing" } });
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("Picker");
    expect(mocks.paths).not.toHaveBeenCalled();
  });
  it("stops before workspace loading when app settings are unavailable", async () => {
    mocks.preview.mockResolvedValue({ status: "invalid", filePath: "/root/settings.json" });
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("/root/settings.json");
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.paths).not.toHaveBeenCalled();
  });
  it("records a new workspace only after it successfully opens", async () => {
    mocks.config.knownWorkspaces = ["known"];
    host = await mount(createElement(App));
    await click("Open");
    expect(mocks.paths).toHaveBeenCalledWith("new-w");
    expect(document.body.textContent).toBe("Main");
  });
  it("lets a stalled startup read finish without adopting it after choosing another workspace", async () => {
    mocks.state.lastWorkspacePath = "slow-w";
    let finish!: (value: { kind: "success" }) => void;
    mocks.open.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    host = await mount(createElement(App));
    expect(document.body.textContent).toContain("Opening workspace");
    const isCurrent = mocks.open.mock.calls[0][1] as () => boolean;
    expect(isCurrent()).toBe(true);
    await click("Choose another workspace");
    expect(isCurrent()).toBe(false);
    await click("Open");
    expect(document.body.textContent).toBe("Main");
    await act(async () => finish({ kind: "success" }));
    expect(document.body.textContent).toBe("Main");
    expect(mocks.paths).toHaveBeenCalledExactlyOnceWith("new-w");
  });

  it("ignores a late rejection after leaving the pending startup attempt", async () => {
    mocks.state.lastWorkspacePath = "slow-w";
    let reject!: (reason: Error) => void;
    mocks.open.mockReturnValueOnce(new Promise((_resolve, failed) => { reject = failed; }));
    host = await mount(createElement(App));
    await click("Choose another workspace");
    await click("Open");
    await act(async () => reject(new Error("volume disconnected")));
    expect(document.body.textContent).toBe("Main");
    expect(mocks.paths).toHaveBeenCalledExactlyOnceWith("new-w");
  });

});
