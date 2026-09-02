import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PreferencesDto } from "../../src/models";

const loadPreferences = vi.fn();
const flushPreferences = vi.fn();

vi.mock("../../src/repositories", () => ({
  loadPreferences: (p: string) => loadPreferences(p),
  flushPreferences: (p: string, getPrefs: () => PreferencesDto) => flushPreferences(p, getPrefs),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { usePreferencesStore } from "../../src/state/preferences-store";
import { createDefaultPreferences } from "../../src/models";

beforeEach(() => {
  loadPreferences.mockReset();
  flushPreferences.mockReset();
  usePreferencesStore.setState({
    preferences: createDefaultPreferences("Default"),
    filePath: "",
    loaded: false,
  });
});

describe("load", () => {
  it("sets preferences, file path, and loaded flag on success", async () => {
    const prefs = { ...createDefaultPreferences("Loaded"), dueSoonDays: 3 };
    loadPreferences.mockResolvedValue({ status: "success", preferences: prefs });

    const result = await usePreferencesStore.getState().load("/prefs.json");
    expect(result.status).toBe("success");
    const state = usePreferencesStore.getState();
    expect(state.preferences.dueSoonDays).toBe(3);
    expect(state.filePath).toBe("/prefs.json");
    expect(state.loaded).toBe(true);
  });

  it("returns the failure result and leaves state untouched on non-success", async () => {
    loadPreferences.mockResolvedValue({ status: "error", message: "bad" });
    const result = await usePreferencesStore.getState().load("/prefs.json");
    expect(result).toEqual({ status: "error", message: "bad" });
    expect(usePreferencesStore.getState().loaded).toBe(false);
  });
});

describe("update", () => {
  it("applies changes synchronously before any flush resolves", () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    flushPreferences.mockResolvedValue(usePreferencesStore.getState().preferences);
    void usePreferencesStore.getState().update({ dueSoonDays: 10 });
    // The synchronous set ran already, even though the flush promise is pending.
    expect(usePreferencesStore.getState().preferences.dueSoonDays).toBe(10);
  });

  it("does not flush when no file path is set", async () => {
    await usePreferencesStore.getState().update({ handledTasksPageSize: 25 });
    expect(usePreferencesStore.getState().preferences.handledTasksPageSize).toBe(25);
    expect(flushPreferences).not.toHaveBeenCalled();
  });

  it("absorbs repository normalization back into state", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    // Repository coerces an invalid timezone to null on save.
    flushPreferences.mockImplementation(async (_p, getPrefs: () => PreferencesDto) => ({
      ...getPrefs(),
      timezone: null,
    }));

    await usePreferencesStore.getState().update({ timezone: "Bad/Zone" });
    expect(flushPreferences).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().preferences.timezone).toBeNull();
  });

  it("rolls back its optimistic fields after a failed write so Save can retry", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    flushPreferences.mockRejectedValue(new Error("disk full"));

    const result = await usePreferencesStore.getState().update({ dueSoonDays: 10 });

    expect(result).toEqual({
      status: "error",
      message:
        "Preferences could not be saved. Your previous settings are still in use; try again.",
    });
    expect(usePreferencesStore.getState().preferences.dueSoonDays).toBe(7);
  });

  it("does not let an older write completion erase a newer update", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    let resolveFirst!: () => void;
    flushPreferences
      .mockImplementationOnce(
        async (_p, getPrefs: () => PreferencesDto) => {
          const snapshot = getPrefs();
          return await new Promise<PreferencesDto>((resolve) => {
            resolveFirst = () => resolve(snapshot);
          });
        },
      )
      .mockImplementationOnce(async (_p, getPrefs: () => PreferencesDto) =>
        getPrefs(),
      );

    const first = usePreferencesStore.getState().update({ dueSoonDays: 10 });
    const second = usePreferencesStore.getState().update({ theme: "dark" });
    expect(usePreferencesStore.getState().preferences.theme).toBe("dark");

    resolveFirst();
    await Promise.all([first, second]);

    const preferences = usePreferencesStore.getState().preferences;
    expect(preferences.dueSoonDays).toBe(10);
    expect(preferences.theme).toBe("dark");
  });

  it("keeps a later edit already captured by an earlier successful write", async () => {
    usePreferencesStore.setState({ filePath: "/p.json" });
    let releaseFirst!: () => void;
    flushPreferences
      .mockImplementationOnce(
        async (_p, getPrefs: () => PreferencesDto) => {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return getPrefs();
        },
      )
      .mockRejectedValueOnce(new Error("second write failed"));

    const first = usePreferencesStore.getState().update({ dueSoonDays: 10 });
    const second = usePreferencesStore.getState().update({ theme: "dark" });
    releaseFirst();
    await first;
    await second;

    const preferences = usePreferencesStore.getState().preferences;
    expect(preferences.dueSoonDays).toBe(10);
    expect(preferences.theme).toBe("dark");
  });
});
