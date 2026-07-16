import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppConfigDto } from "../../src/models";

const initializeAppConfig = vi.fn();
const flushAppConfig = vi.fn();

vi.mock("../../src/repositories", () => ({
  initializeAppConfig: () => initializeAppConfig(),
  flushAppConfig: (p: string, getConfig: () => AppConfigDto) => flushAppConfig(p, getConfig),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useAppConfigStore } from "../../src/state/app-config-store";
import { createDefaultAppConfig } from "../../src/models";

beforeEach(() => {
  initializeAppConfig.mockReset();
  flushAppConfig.mockReset();
  flushAppConfig.mockResolvedValue(undefined);
  useAppConfigStore.setState({
    config: createDefaultAppConfig(),
    filePath: "",
    loaded: false,
  });
});

describe("updateViewState", () => {
  it("applies a zoom change synchronously and flushes to state.json", async () => {
    useAppConfigStore.setState({ filePath: "/state.json" });

    await useAppConfigStore.getState().updateViewState({ zoomLevel: 1.5 });

    expect(useAppConfigStore.getState().config.zoomLevel).toBe(1.5);
    // Flushed through the same per-path serial write the other actions use.
    expect(flushAppConfig).toHaveBeenCalledTimes(1);
    expect(flushAppConfig.mock.calls[0][0]).toBe("/state.json");
    // The getter passed to the repository sees the latest state at write time.
    expect(flushAppConfig.mock.calls[0][1]().zoomLevel).toBe(1.5);
  });

  it("merges a partial patch without disturbing the path-tracking fields", async () => {
    useAppConfigStore.setState({
      filePath: "/state.json",
      config: {
        ...createDefaultAppConfig(),
        knownPreferences: ["/x/preferences.json"],
        lastPreferencesPath: "/x/preferences.json",
      },
    });

    await useAppConfigStore.getState().updateViewState({ sidebarWidth: 440 });

    const config = useAppConfigStore.getState().config;
    expect(config.sidebarWidth).toBe(440);
    // The view patch must not touch the register/unregister-owned fields.
    expect(config.knownPreferences).toEqual(["/x/preferences.json"]);
    expect(config.lastPreferencesPath).toBe("/x/preferences.json");
  });

  it("does not flush when no file path is set", async () => {
    await useAppConfigStore.getState().updateViewState({ zoomLevel: 2 });
    expect(useAppConfigStore.getState().config.zoomLevel).toBe(2);
    expect(flushAppConfig).not.toHaveBeenCalled();
  });
});
