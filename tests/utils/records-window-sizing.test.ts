import { describe, expect, it } from "vitest";
import {
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_FILTERS_HEIGHT,
  RECORDS_LIST_MIN_HEIGHT,
  RECORDS_LIST_WIDTH,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
  clampRecordsListWidth,
} from "../../src/utils/recordsWindowSizing";
import { SPLITTER_WIDTH } from "../../src/utils/windowSizing";
import { createDefaultAppState } from "../../src/models";

describe("Records window sizing", () => {
  it("derives the window minimum from the panes", () => {
    expect(RECORDS_WINDOW_MIN_WIDTH).toBe(RECORDS_LIST_WIDTH.min + SPLITTER_WIDTH + RECORDS_DETAIL_MIN_WIDTH);
    expect(RECORDS_WINDOW_MIN_HEIGHT).toBe(RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT);
  });

  it("offers about 320 to 640 pixels for the list, 380 at first", () => {
    expect(RECORDS_LIST_WIDTH).toEqual({ min: 320, default: 380, max: 640 });
    expect(createDefaultAppState().recordsListWidth).toBe(RECORDS_LIST_WIDTH.default);
  });

  it("shows the intent while the window has room for it", () => {
    expect(clampRecordsListWidth(450, 2000)).toBe(450);
  });

  it("narrows the list as the window narrows, never below its minimum", () => {
    expect(clampRecordsListWidth(600, 900)).toBe(900 - SPLITTER_WIDTH - RECORDS_DETAIL_MIN_WIDTH);
    expect(clampRecordsListWidth(600, RECORDS_WINDOW_MIN_WIDTH)).toBe(RECORDS_LIST_WIDTH.min);
    expect(clampRecordsListWidth(600, 300)).toBe(RECORDS_LIST_WIDTH.min);
  });

  it("keeps the intent within the pane's bounds before the window has measured", () => {
    expect(clampRecordsListWidth(900, 0)).toBe(RECORDS_LIST_WIDTH.max);
    expect(clampRecordsListWidth(100, 0)).toBe(RECORDS_LIST_WIDTH.min);
  });
});
