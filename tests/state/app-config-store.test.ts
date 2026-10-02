import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfigDto } from "../../src/models";
const loadAppConfig = vi.fn();
const flushAppConfig = vi.fn();
const flushAppState = vi.fn();
vi.mock("../../src/repositories", () => ({
  loadAppConfig: () => loadAppConfig(),
  flushAppConfig: (path: string, getConfig: () => AppConfigDto) => flushAppConfig(path, getConfig),
  flushAppState: (path: string, getState: () => unknown) => flushAppState(path, getState),
  log: { error: vi.fn() }, toErrorFields: (e: unknown) => ({ error: String(e) }),
}));
import { createDefaultAppState } from "../../src/models";
import { useAppConfigStore } from "../../src/state/app-config-store";
import { useAppStateStore } from "../../src/state/app-state-store";
import { useToastStore } from "../../src/state/toast-store";
const defaults = { knownPreferences: ["/preferences.json"], knownWorkspaces: ["/workspace.json"] };
const selection = () => {
  const { lastPreferencesPath, lastWorkspacePath } = useAppStateStore.getState().appState;
  return { lastPreferencesPath, lastWorkspacePath };
};
beforeEach(async () => {
  loadAppConfig.mockReset().mockResolvedValue({ appConfig: defaults, filePath: "/config.json", quarantinedTo: null });
  flushAppConfig.mockReset().mockImplementation(async (_path, getConfig) => { getConfig(); });
  flushAppState.mockReset().mockResolvedValue(undefined);
  useToastStore.setState({ message: null, backgroundWriteError: null });
  useAppStateStore.setState({
    appState: { ...createDefaultAppState(), lastPreferencesPath: "/preferences.json", lastWorkspacePath: "/workspace.json" },
    filePath: "/state.json",
  });
  await useAppConfigStore.getState().initialize();
});

describe("known-document list changes", () => {
  it("selecting an already known default document writes no config file", async () => {
    expect(await useAppConfigStore.getState().registerAndSelect("preferences", "/preferences.json")).toBe(true);
    expect(flushAppConfig).not.toHaveBeenCalled();
  });
  it("registering one workspace writes the config from memory, then selects it", async () => {
    expect(await useAppConfigStore.getState().registerAndSelect("workspace", "/second.json")).toBe(true);
    expect(flushAppConfig).toHaveBeenCalledOnce();
    expect(flushAppConfig.mock.calls[0][0]).toBe("/config.json");
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownWorkspaces: ["/workspace.json", "/second.json"] });
    expect(selection()).toEqual({ lastPreferencesPath: "/preferences.json", lastWorkspacePath: "/second.json" });
  });
  it("unregistering the selected document moves the selection to the first one left", async () => {
    await useAppConfigStore.getState().registerAndSelect("preferences", "/other.json");
    expect(await useAppConfigStore.getState().unregisterAndReselect("preferences", "/other.json")).toBe(true);
    expect(useAppConfigStore.getState().appConfig.knownPreferences).toEqual(["/preferences.json"]);
    expect(selection().lastPreferencesPath).toBe("/preferences.json");
  });
  it("unregistering the final document writes an empty authored list", async () => {
    await useAppConfigStore.getState().unregisterAndReselect("preferences", "/preferences.json");
    expect(useAppConfigStore.getState().appConfig.knownPreferences).toEqual([]);
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownPreferences: [] });
    expect(selection().lastPreferencesPath).toBe("");
  });
  it("a failed register keeps the list change, selects nothing, and the next write saves it", async () => {
    flushAppConfig.mockRejectedValueOnce(new Error("disk full"));
    expect(await useAppConfigStore.getState().registerAndSelect("workspace", "/second.json")).toBe(false);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json", "/second.json"]);
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
    expect(flushAppState).not.toHaveBeenCalled();
    expect(useToastStore.getState().backgroundWriteError?.what).toBe("savedLocations");
    expect(await useAppConfigStore.getState().registerAndSelect("workspace", "/third.json")).toBe(true);
    expect(flushAppConfig.mock.calls[1][1]().knownWorkspaces).toEqual(["/workspace.json", "/second.json", "/third.json"]);
    expect(selection().lastWorkspacePath).toBe("/third.json");
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
  it("a failed unregister keeps the list change and the selection", async () => {
    flushAppConfig.mockRejectedValueOnce(new Error("disk full"));
    expect(await useAppConfigStore.getState().unregisterAndReselect("preferences", "/preferences.json")).toBe(false);
    expect(useAppConfigStore.getState().appConfig.knownPreferences).toEqual([]);
    expect(selection().lastPreferencesPath).toBe("/preferences.json");
    expect(flushAppState).not.toHaveBeenCalled();
  });
  it("an older completion cannot erase later synchronous list additions", async () => {
    let release!: () => void;
    flushAppConfig.mockImplementationOnce(async (_path, getConfig) => {
      getConfig();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const first = useAppConfigStore.getState().registerAndSelect("workspace", "/second.json");
    const second = useAppConfigStore.getState().registerAndSelect("workspace", "/third.json");
    release();
    await Promise.all([first, second]);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json", "/second.json", "/third.json"]);
  });
});
