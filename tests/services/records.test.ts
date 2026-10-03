import { describe, expect, it } from "vitest";
import type { RecordSummary } from "../../src/models/records";
import {
  cursorAfter,
  hasFields,
  initialRecordsWindow,
  mergeNewestPage,
  prettyJson,
} from "../../src/services/records";
import { RECORDS_LIST_WIDTH } from "../../src/utils/recordsWindowSizing";

const SESSION = "2026-10-02T08:00:00.000Z";

function record(id: number, time: string): RecordSummary {
  return { id, session: SESSION, time, level: "info", message: `m${id}`, taskId: null };
}

const a = record(1, "2026-10-02T08:00:01.000Z");
const b = record(2, "2026-10-02T08:00:02.000Z");
const c = record(3, "2026-10-02T08:00:03.000Z");
const d = record(4, "2026-10-02T08:00:04.000Z");

describe("prettyJson", () => {
  it("indents stored JSON and leaves other text as it is", () => {
    expect(prettyJson('{"path":"/a","n":1}')).toBe('{\n  "path": "/a",\n  "n": 1\n}');
    expect(prettyJson("not json")).toBe("not json");
  });
});

describe("hasFields", () => {
  it("is false only for an empty object", () => {
    expect(hasFields("{}")).toBe(false);
    expect(hasFields('{"command":"hash_file"}')).toBe(true);
    expect(hasFields("[]")).toBe(true);
    expect(hasFields("plain text")).toBe(true);
  });
});

describe("cursorAfter", () => {
  it("starts the next page after the last row shown", () => {
    expect(cursorAfter([c, b])).toEqual({ time: b.time, id: 2 });
    expect(cursorAfter([])).toBeNull();
  });
});

describe("mergeNewestPage", () => {
  it("puts new records above the rows shown and keeps every page already read", () => {
    const merged = mergeNewestPage([c, b, a], true, { records: [d, c], more: true });
    expect(merged.records.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    // The rows beyond the newest page still lead to the pages after them.
    expect(merged.more).toBe(true);
  });

  it("takes the page's word on more when it reaches past every row shown", () => {
    const merged = mergeNewestPage([b], true, { records: [d, c, b, a], more: false });
    expect(merged.records.map((r) => r.id)).toEqual([4, 3, 2, 1]);
    expect(merged.more).toBe(false);
  });

  it("orders records at the same instant by id, newest first", () => {
    const same = "2026-10-02T08:00:00.000Z";
    const merged = mergeNewestPage([record(5, same)], false, { records: [record(6, same)], more: false });
    expect(merged.records.map((r) => r.id)).toEqual([6, 5]);
  });

  it("takes the page's copy of a row it shares with the rows shown", () => {
    const updated = { ...c, message: "updated" };
    const merged = mergeNewestPage([c, b], false, { records: [updated], more: false });
    expect(merged.records[0]!.message).toBe("updated");
  });
});

describe("initialRecordsWindow", () => {
  it("reads what the main window opened it with", () => {
    expect(
      initialRecordsWindow("?listWidth=420&language=ja&locale=ja-JP&timeZone=Asia%2FTokyo"),
    ).toEqual({ listWidth: 420, context: { language: "ja", locale: "ja-JP", timeZone: "Asia/Tokyo" } });
  });

  it("keeps the list width within the pane's bounds", () => {
    expect(initialRecordsWindow("?listWidth=9000").listWidth).toBe(RECORDS_LIST_WIDTH.max);
    expect(initialRecordsWindow("?listWidth=10").listWidth).toBe(RECORDS_LIST_WIDTH.min);
  });

  it("falls back to the defaults for anything missing or unusable", () => {
    expect(initialRecordsWindow("")).toEqual({
      listWidth: RECORDS_LIST_WIDTH.default,
      context: { language: "en", locale: "en", timeZone: null },
    });
    expect(initialRecordsWindow("?listWidth=wide&language=xx&locale=%5B%5D&timeZone=Mars%2FBase").context).toEqual({
      language: "en",
      locale: "en",
      timeZone: null,
    });
  });
});
