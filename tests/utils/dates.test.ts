import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  nowUtc,
  todayInTimezone,
  tomorrowInTimezone,
  formatTimestamp,
  formatDueDate,
  isOverdue,
  isDueInDayRange,
} from "../../src/utils/dates";

// Pin "now" to a moment where UTC and Asia/Tokyo (UTC+9) fall on different
// calendar dates, so timezone handling is actually exercised:
//   2026-06-04T20:00:00Z  ==  2026-06-05T05:00:00 in Tokyo.
const FIXED_NOW = "2026-06-04T20:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nowUtc", () => {
  it("returns the current instant as an ISO UTC string", () => {
    expect(nowUtc()).toBe(FIXED_NOW);
  });
});

describe("todayInTimezone / tomorrowInTimezone", () => {
  it("returns the calendar date in the given timezone", () => {
    expect(todayInTimezone("UTC")).toBe("2026-06-04");
    // Tokyo is already on the 5th at this instant.
    expect(todayInTimezone("Asia/Tokyo")).toBe("2026-06-05");
  });

  it("adds one day relative to the timezone-adjusted date", () => {
    expect(tomorrowInTimezone("UTC")).toBe("2026-06-05");
    expect(tomorrowInTimezone("Asia/Tokyo")).toBe("2026-06-06");
  });

  it("falls back to system timezone for an invalid zone (no throw)", () => {
    // coerceTimezone rejects the bad zone -> null -> system tz; just assert shape.
    expect(todayInTimezone("Not/AZone")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isOverdue", () => {
  it("is true for a date before today in the timezone", () => {
    expect(isOverdue("2026-06-03", "UTC")).toBe(true);
  });

  it("is false for today", () => {
    expect(isOverdue("2026-06-04", "UTC")).toBe(false);
  });

  it("is false for a future date", () => {
    expect(isOverdue("2026-06-10", "UTC")).toBe(false);
  });

  it("respects the timezone when deciding today", () => {
    // In Tokyo, today is the 5th, so the 4th is overdue there but not in UTC.
    expect(isOverdue("2026-06-04", "Asia/Tokyo")).toBe(true);
    expect(isOverdue("2026-06-04", "UTC")).toBe(false);
  });
});

describe("isDueInDayRange", () => {
  it("matches today only with startOffset 0, count 1", () => {
    expect(isDueInDayRange("2026-06-04", 0, 1, "UTC")).toBe(true);
    expect(isDueInDayRange("2026-06-05", 0, 1, "UTC")).toBe(false);
  });

  it("matches tomorrow through today+count with startOffset 1", () => {
    // window: 2026-06-05 .. 2026-06-11
    expect(isDueInDayRange("2026-06-05", 1, 7, "UTC")).toBe(true);
    expect(isDueInDayRange("2026-06-11", 1, 7, "UTC")).toBe(true);
    expect(isDueInDayRange("2026-06-12", 1, 7, "UTC")).toBe(false);
    expect(isDueInDayRange("2026-06-04", 1, 7, "UTC")).toBe(false);
  });

  it("returns false for a non-positive count", () => {
    expect(isDueInDayRange("2026-06-05", 1, 0, "UTC")).toBe(false);
    expect(isDueInDayRange("2026-06-05", 1, -3, "UTC")).toBe(false);
  });
});

describe("formatDueDate", () => {
  it("formats a date-only string using user tokens (YYYY-MM-DD)", () => {
    expect(formatDueDate("2026-06-04", "YYYY-MM-DD")).toBe("2026-06-04");
  });

  it("honors a custom date format", () => {
    expect(formatDueDate("2026-06-04", "DD/MM/YYYY")).toBe("04/06/2026");
  });

  it("passes through an unparseable string unchanged", () => {
    expect(formatDueDate("not-a-date", "YYYY-MM-DD")).toBe("not-a-date");
  });
});

describe("formatTimestamp", () => {
  it("converts an instant into the target timezone and 24h time", () => {
    // 2026-06-04T20:00Z is 2026-06-05 05:00 in Tokyo.
    expect(formatTimestamp(FIXED_NOW, "YYYY-MM-DD", "24h", "Asia/Tokyo")).toBe("2026-06-05 05:00");
  });

  it("formats 12h time with an AM/PM marker", () => {
    const result = formatTimestamp(FIXED_NOW, "YYYY-MM-DD", "12h", "Asia/Tokyo");
    expect(result).toBe("2026-06-05 05:00 AM");
  });

  it("passes through an invalid timestamp unchanged", () => {
    expect(formatTimestamp("nonsense", "YYYY-MM-DD", "24h", "UTC")).toBe("nonsense");
  });
});
