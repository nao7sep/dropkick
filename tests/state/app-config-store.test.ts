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
const defaults = { knownWorkspaces: ["/workspace.json"] };
const selection = () => {
  const { lastWorkspacePath } = useAppStateStore.getState().appState;
  return { lastWorkspacePath };
};
beforeEach(async () => {
  loadAppConfig.mockReset().mockResolvedValue({ appConfig: defaults, filePath: "/config.json", quarantinedTo: null });
  flushAppConfig.mockReset().mockImplementation(async (_path, getConfig) => { getConfig(); });
  flushAppState.mockReset().mockResolvedValue(undefined);
  useToastStore.setState({ message: null, backgroundWriteError: null });
  useAppStateStore.setState({
    appState: { ...createDefaultAppState(), lastWorkspacePath: "/workspace.json" },
    filePath: "/state.json",
  });
  await useAppConfigStore.getState().initialize();
});

describe("known-document list changes", () => {
  it("selecting an already known default document writes no config file", async () => {
    expect(await useAppConfigStore.getState().register("/workspace.json")).toBe(true);
    expect(flushAppConfig).not.toHaveBeenCalled();
  });
  it("registering one workspace writes the config from memory, without changing the workspace selection", async () => {
    expect(await useAppConfigStore.getState().register("/second.json")).toBe(true);
    expect(flushAppConfig).toHaveBeenCalledOnce();
    expect(flushAppConfig.mock.calls[0][0]).toBe("/config.json");
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownWorkspaces: ["/workspace.json", "/second.json"] });
    expect(selection()).toEqual({ lastWorkspacePath: "/workspace.json" });
  });
  it("unregistering a document preserves the last workspace selection", async () => {
    await useAppConfigStore.getState().register("/other.json");
    expect(await useAppConfigStore.getState().unregister("/other.json")).toBe(true);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json"]);
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
  });
  it("unregistering the final document writes an empty authored list", async () => {
    await useAppConfigStore.getState().unregister("/workspace.json");
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual([]);
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownWorkspaces: [] });
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
  });
  it("a failed register undoes the list change, selects nothing, and a retry writes it", async () => {
    flushAppConfig.mockRejectedValueOnce(new Error("disk full"));
    expect(await useAppConfigStore.getState().register("/second.json")).toBe(false);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json"]);
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
    expect(flushAppState).not.toHaveBeenCalled();
    expect(useToastStore.getState().backgroundWriteError?.what).toBe("savedLocations");
    expect(await useAppConfigStore.getState().register("/second.json")).toBe(true);
    expect(flushAppConfig).toHaveBeenCalledTimes(2);
    expect(flushAppConfig.mock.calls[1][1]().knownWorkspaces).toEqual(["/workspace.json", "/second.json"]);
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
  it("a failed unregister keeps the row and the selection, and a retry writes it", async () => {
    flushAppConfig.mockRejectedValueOnce(new Error("disk full"));
    expect(await useAppConfigStore.getState().unregister("/workspace.json")).toBe(false);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json"]);
    expect(selection().lastWorkspacePath).toBe("/workspace.json");
    expect(flushAppState).not.toHaveBeenCalled();
    expect(await useAppConfigStore.getState().unregister("/workspace.json")).toBe(true);
    expect(flushAppConfig).toHaveBeenCalledTimes(2);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual([]);
  });
  it("an older completion cannot erase later synchronous list additions", async () => {
    let release!: () => void;
    flushAppConfig.mockImplementationOnce(async (_path, getConfig) => {
      getConfig();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const first = useAppConfigStore.getState().register("/second.json");
    const second = useAppConfigStore.getState().register("/third.json");
    release();
    await Promise.all([first, second]);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json", "/second.json", "/third.json"]);
  });
});
