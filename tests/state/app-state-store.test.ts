import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AppStateDto } from "../../src/models";

const initializeAppState = vi.fn();
const flushAppState = vi.fn();

vi.mock("../../src/repositories", () => ({
  initializeAppState: () => initializeAppState(),
  flushAppState: (p: string, getConfig: () => AppStateDto) => flushAppState(p, getConfig),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  toErrorFields: (e: unknown) => ({ error: { message: String(e) } }),
}));

import { useAppStateStore } from "../../src/state/app-state-store";
import { useToastStore } from "../../src/state/toast-store";
import { createDefaultAppState } from "../../src/models";

beforeEach(() => {
  initializeAppState.mockReset();
  flushAppState.mockReset();
  flushAppState.mockResolvedValue(undefined);
  useAppStateStore.setState({
    appState: createDefaultAppState(),
    filePath: "",
    loaded: false,
  });
  useToastStore.setState({ message: null });
});

describe("updateViewState", () => {
  it("applies a zoom change synchronously and flushes to state.json", async () => {
    useAppStateStore.setState({ filePath: "/state.json" });

    await useAppStateStore.getState().updateViewState({ zoomLevel: 1.5 });

    expect(useAppStateStore.getState().appState.zoomLevel).toBe(1.5);
    // Flushed through the same per-path serial write the other actions use.
    expect(flushAppState).toHaveBeenCalledTimes(1);
    expect(flushAppState.mock.calls[0][0]).toBe("/state.json");
    // The getter passed to the repository sees the latest state at write time.
    expect(flushAppState.mock.calls[0][1]().zoomLevel).toBe(1.5);
  });

  it("merges a partial patch without disturbing the path-tracking fields", async () => {
    useAppStateStore.setState({
      filePath: "/state.json",
      appState: {
        ...createDefaultAppState(),
        knownPreferences: ["/x/preferences.json"],
        lastPreferencesPath: "/x/preferences.json",
      },
    });

    await useAppStateStore.getState().updateViewState({ sidebarWidth: 440 });

    const appState = useAppStateStore.getState().appState;
    expect(appState.sidebarWidth).toBe(440);
    // The view patch must not touch the register/unregister-owned fields.
    expect(appState.knownPreferences).toEqual(["/x/preferences.json"]);
    expect(appState.lastPreferencesPath).toBe("/x/preferences.json");
  });

  it("does not flush when no file path is set", async () => {
    await useAppStateStore.getState().updateViewState({ zoomLevel: 2 });
    expect(useAppStateStore.getState().appState.zoomLevel).toBe(2);
    expect(flushAppState).not.toHaveBeenCalled();
  });
});

describe("saved locations", () => {
  it("names a failed location write accurately", async () => {
    useAppStateStore.setState({ filePath: "/state.json" });
    flushAppState.mockRejectedValueOnce(new Error("disk full"));

    await useAppStateStore.getState().registerPreferences("/prefs.json");

    expect(useToastStore.getState().message).toBe(
      "Your saved locations could not be saved.",
    );
  });
});
