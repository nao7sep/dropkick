// @vitest-environment happy-dom

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordsContext } from "../../src/models/records";
import type { RecordsWindowOpening } from "../../src/repositories/records";
import { mount, type Mounted } from "../helpers/react-dom";

const records = vi.hoisted(() => ({
  openRecordsWindow: vi.fn<(opening: RecordsWindowOpening) => Promise<void>>(),
  sendRecordsContext: vi.fn<(context: RecordsContext) => Promise<void>>(),
  width: null as ((width: number) => void) | null,
}));
const shell = vi.hoisted(() => ({
  showMessage: vi.fn(),
  flushAppState: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/repositories/records", () => ({
  openRecordsWindow: records.openRecordsWindow,
  sendRecordsContext: records.sendRecordsContext,
  onRecordsListWidthCommitted: (listener: (width: number) => void) => {
    records.width = listener;
    return () => {
      records.width = null;
    };
  },
}));
vi.mock("../../src/repositories", () => ({
  showMessage: shell.showMessage,
  flushAppState: shell.flushAppState,
  log: shell.log,
  toErrorFields: (e: unknown) => ({ error: { message: String(e) } }),
}));

import { useRecordsWindow } from "../../src/hooks/useRecordsWindow";
import { useAppStateStore } from "../../src/state/app-state-store";
import { usePreferencesStore } from "../../src/state/preferences-store";
import { useLanguageStore } from "../../src/state/language-store";
import { createDefaultAppState, createDefaultPreferences } from "../../src/models";
import { RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from "../../src/utils/recordsWindowSizing";

let open: (() => Promise<void>) | null = null;
function Host() {
  open = useRecordsWindow();
  return null;
}

let mounted: Mounted | null = null;

beforeEach(async () => {
  records.openRecordsWindow.mockReset();
  records.openRecordsWindow.mockResolvedValue();
  records.sendRecordsContext.mockReset();
  records.sendRecordsContext.mockResolvedValue();
  shell.showMessage.mockReset();
  shell.flushAppState.mockReset();
  shell.flushAppState.mockResolvedValue(undefined);
  useAppStateStore.setState({
    appState: { ...createDefaultAppState(), recordsListWidth: 450 },
    filePath: "/state.json",
    loaded: true,
  });
  usePreferencesStore.setState({
    preferences: { ...createDefaultPreferences("Default"), language: "ja", timezone: "Asia/Tokyo", theme: "dark" },
  });
  useLanguageStore.setState({ systemLanguage: "en", systemLocale: "en-US" });
  mounted = await mount(createElement(Host));
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

describe("useRecordsWindow", () => {
  it("opens the Records window with the settings and list width the main window holds", async () => {
    await act(async () => open!());

    expect(records.openRecordsWindow).toHaveBeenCalledExactlyOnceWith({
      minWidth: RECORDS_WINDOW_MIN_WIDTH,
      minHeight: RECORDS_WINDOW_MIN_HEIGHT,
      listWidth: 450,
      language: "ja",
      locale: "ja",
      timeZone: "Asia/Tokyo",
      theme: "dark",
    });
  });

  it("says so when the window cannot be opened", async () => {
    records.openRecordsWindow.mockRejectedValueOnce("no window");
    await act(async () => open!());

    expect(shell.log.error).toHaveBeenCalledWith("records window open failed", expect.anything());
    expect(shell.showMessage).toHaveBeenCalledWith(
      { key: "records.openFailed.title", values: undefined },
      { key: "records.openFailed.body", values: undefined },
    );
  });

  it("tells the Records window when the language or time zone changes", async () => {
    expect(records.sendRecordsContext).toHaveBeenLastCalledWith({ language: "ja", locale: "ja", timeZone: "Asia/Tokyo" });

    await act(async () => {
      usePreferencesStore.setState({
        preferences: { ...usePreferencesStore.getState().preferences, language: "system", timezone: "system" },
      });
    });

    expect(records.sendRecordsContext).toHaveBeenLastCalledWith({ language: "en", locale: "en-US", timeZone: null });
  });

  it("persists the width the Records window hands back, within the pane's bounds", async () => {
    await act(async () => records.width!(512.4));
    expect(useAppStateStore.getState().appState.recordsListWidth).toBe(512);
    expect(shell.flushAppState).toHaveBeenCalledTimes(1);
    expect(shell.flushAppState.mock.calls[0][1]().recordsListWidth).toBe(512);

    await act(async () => records.width!(5000));
    expect(useAppStateStore.getState().appState.recordsListWidth).toBe(RECORDS_LIST_WIDTH.max);

    await act(async () => records.width!(Number.NaN));
    expect(shell.flushAppState).toHaveBeenCalledTimes(2);
  });
});
