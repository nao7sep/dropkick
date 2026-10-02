import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfigDto } from "../../src/models";
const loadAppConfig = vi.fn();
const flushAppConfig = vi.fn();
vi.mock("../../src/repositories", () => ({
  loadAppConfig: () => loadAppConfig(),
  flushAppConfig: (path: string, getConfig: () => AppConfigDto) => flushAppConfig(path, getConfig),
  log: { error: vi.fn() }, toErrorFields: (e: unknown) => ({ error: String(e) }),
}));
import { useAppConfigStore } from "../../src/state/app-config-store";
import { useToastStore } from "../../src/state/toast-store";
const defaults = { knownPreferences: ["/preferences.json"], knownWorkspaces: ["/workspace.json"] };
beforeEach(async () => {
  loadAppConfig.mockReset().mockResolvedValue({ appConfig: defaults, filePath: "/config.json", quarantinedTo: null });
  flushAppConfig.mockReset().mockImplementation(async (_path, getConfig) => { getConfig(); });
  useToastStore.setState({ message: null, backgroundWriteError: null });
  await useAppConfigStore.getState().initialize();
});

describe("known-document list changes", () => {
  it("selecting an already known default document writes no config file", async () => {
    await useAppConfigStore.getState().registerPreferences("/preferences.json");
    expect(flushAppConfig).not.toHaveBeenCalled();
  });
  it("registering one workspace writes the config from memory", async () => {
    await useAppConfigStore.getState().registerWorkspace("/second.json");
    expect(flushAppConfig).toHaveBeenCalledOnce();
    expect(flushAppConfig.mock.calls[0][0]).toBe("/config.json");
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownWorkspaces: ["/workspace.json", "/second.json"] });
  });
  it("unregistering the final document writes an empty authored list", async () => {
    await useAppConfigStore.getState().unregisterPreferences("/preferences.json");
    expect(useAppConfigStore.getState().appConfig.knownPreferences).toEqual([]);
    expect(flushAppConfig.mock.calls[0][1]()).toEqual({ ...defaults, knownPreferences: [] });
  });
  it("a failed write restores the confirmed list and leaves registration retryable", async () => {
    flushAppConfig.mockRejectedValueOnce(new Error("disk full"));
    await useAppConfigStore.getState().registerWorkspace("/second.json");
    expect(useAppConfigStore.getState().appConfig).toEqual(defaults);
    expect(useToastStore.getState().backgroundWriteError?.what).toBe("savedLocations");
    await useAppConfigStore.getState().registerWorkspace("/second.json");
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json", "/second.json"]);
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
  it("an older completion cannot erase later synchronous list additions", async () => {
    let release!: () => void;
    flushAppConfig.mockImplementationOnce(async (_path, getConfig) => {
      getConfig();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const first = useAppConfigStore.getState().registerWorkspace("/second.json");
    const second = useAppConfigStore.getState().registerWorkspace("/third.json");
    release();
    await Promise.all([first, second]);
    expect(useAppConfigStore.getState().appConfig.knownWorkspaces).toEqual(["/workspace.json", "/second.json", "/third.json"]);
  });
});
