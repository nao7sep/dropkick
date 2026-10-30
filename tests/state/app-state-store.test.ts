import { message } from "../../src/i18n/translate";
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

import { useAppStateStore, VIEW_STEP_SAVE_DELAY_MS } from "../../src/state/app-state-store";
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
  useToastStore.setState({ message: null, backgroundWriteError: null });
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
        lastWorkspacePath: "/x/workspace.json",
      },
    });

    await useAppStateStore.getState().updateViewState({ sidebarWidth: 440 });

    const appState = useAppStateStore.getState().appState;
    expect(appState.sidebarWidth).toBe(440);
    // The view patch must not touch the register/unregister-owned fields.
    expect("knownPreferences" in appState).toBe(false);
    expect(appState.lastWorkspacePath).toBe("/x/workspace.json");
  });

  it("does not flush when no file path is set", async () => {
    await useAppStateStore.getState().updateViewState({ zoomLevel: 2 });
    expect(useAppStateStore.getState().appState.zoomLevel).toBe(2);
    expect(flushAppState).not.toHaveBeenCalled();
  });
});

describe("stepViewState", () => {
  it("applies each step at once and saves once, a delay after the last step", async () => {
    vi.useFakeTimers();
    try {
      useAppStateStore.setState({ filePath: "/state.json" });
      const { stepViewState } = useAppStateStore.getState();
      for (const width of [336, 352, 368]) {
        stepViewState({ sidebarWidth: width });
        expect(useAppStateStore.getState().appState.sidebarWidth).toBe(width);
        await vi.advanceTimersByTimeAsync(VIEW_STEP_SAVE_DELAY_MS - 1);
      }
      expect(flushAppState).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(flushAppState).toHaveBeenCalledOnce();
      expect(flushAppState.mock.calls[0][1]().sidebarWidth).toBe(368);
      await vi.advanceTimersByTimeAsync(VIEW_STEP_SAVE_DELAY_MS);
      expect(flushAppState).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a waiting step at once when the window closes, and only once", async () => {
    vi.useFakeTimers();
    try {
      useAppStateStore.setState({ filePath: "/state.json" });
      useAppStateStore.getState().stepViewState({ zoomLevel: 1.1 });
      useAppStateStore.getState().flushViewSteps();
      expect(flushAppState).toHaveBeenCalledOnce();
      expect(flushAppState.mock.calls[0][1]().zoomLevel).toBe(1.1);
      await vi.advanceTimersByTimeAsync(VIEW_STEP_SAVE_DELAY_MS);
      useAppStateStore.getState().flushViewSteps();
      expect(flushAppState).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an immediate save carry a waiting step", async () => {
    vi.useFakeTimers();
    try {
      useAppStateStore.setState({ filePath: "/state.json" });
      useAppStateStore.getState().stepViewState({ sidebarWidth: 400 });
      await useAppStateStore.getState().updateViewState({ zoomLevel: 1 });
      await vi.advanceTimersByTimeAsync(VIEW_STEP_SAVE_DELAY_MS);
      expect(flushAppState).toHaveBeenCalledOnce();
      expect(flushAppState.mock.calls[0][1]()).toMatchObject({ sidebarWidth: 400, zoomLevel: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("saved locations", () => {
  it("remembers only the successfully opened workspace", async () => {
    useAppStateStore.setState({ filePath: "/state.json" });
    await useAppStateStore.getState().setLastWorkspace("/workspace.json");
    expect(useAppStateStore.getState().appState.lastWorkspacePath).toBe("/workspace.json");
    expect(flushAppState.mock.calls[0][1]()).not.toHaveProperty("lastPreferencesPath");
  });

  it("names a failed location write accurately", async () => {
    useAppStateStore.setState({ filePath: "/state.json" });
    flushAppState.mockRejectedValueOnce(new Error("disk full"));

    await useAppStateStore.getState().setLastWorkspace("/prefs.json");

    expect(useToastStore.getState().backgroundWriteError).toEqual({
      what: "savedLocations",
      message: message("write.savedLocations"),
    });
  });

  it("clears a matching save error after a successful retry", async () => {
    useAppStateStore.setState({ filePath: "/state.json" });
    flushAppState.mockRejectedValueOnce(new Error("disk full"));

    await useAppStateStore.getState().updateViewState({ zoomLevel: 1.5 });
    expect(useToastStore.getState().backgroundWriteError).not.toBeNull();

    await useAppStateStore.getState().updateViewState({ sidebarWidth: 420 });
    expect(useToastStore.getState().backgroundWriteError).toBeNull();
  });
});
