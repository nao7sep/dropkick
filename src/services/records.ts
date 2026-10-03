// The Records window's decisions, kept apart from its component: the order it
// lists records in, how a re-read newest page joins the rows already shown,
// where the next page starts, how a stored field reads, and what it starts
// from.

import type { MessageKey } from "../i18n/catalogues";
import { isLanguage } from "../i18n/languages";
import type {
  RecordCursor,
  RecordLevel,
  RecordLevelFilter,
  RecordsContext,
  RecordsPage,
  RecordSummary,
} from "../models/records";
import { isKnownTimeZone } from "../utils/timezone";
import { RECORDS_LIST_WIDTH } from "../utils/recordsWindowSizing";

export const LEVEL_LABELS: Record<RecordLevel, MessageKey> = {
  error: "records.levelError",
  warn: "records.levelWarn",
  info: "records.levelInfo",
  debug: "records.levelDebug",
};

export const LEVEL_FILTER_LABELS: Record<RecordLevelFilter, MessageKey> = {
  attention: "records.levelAttention",
  ...LEVEL_LABELS,
};

// Stored JSON, indented for reading; text that is not JSON is shown as it is.
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// Whether a record's other fields hold anything: `{}` holds nothing to show.
export function hasFields(fields: string): boolean {
  try {
    const value: unknown = JSON.parse(fields);
    return !(typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
  } catch {
    return fields.trim() !== "";
  }
}

// The page after the last record shown.
export function cursorAfter(records: readonly RecordSummary[]): RecordCursor | null {
  const last = records[records.length - 1];
  return last === undefined ? null : { time: last.time, id: last.id };
}

// The order the list shows records in, newest first; the database pages them
// the same way.
function newestFirst(a: RecordSummary, b: RecordSummary): number {
  if (a.time !== b.time) return a.time < b.time ? 1 : -1;
  return b.id - a.id;
}

// The newest page read again, joined with the rows already shown: a row in
// both takes the page's copy, and the rows shown beyond the page stay, so the
// pages already read are kept and a page read out of order loses nothing.
export function mergeNewestPage(
  shown: readonly RecordSummary[],
  shownMore: boolean,
  page: RecordsPage,
): { records: RecordSummary[]; more: boolean } {
  const byId = new Map(shown.map((record) => [record.id, record]));
  for (const record of page.records) byId.set(record.id, record);
  const records = [...byId.values()].sort(newestFirst);
  const last = page.records[page.records.length - 1];
  const beyond = last !== undefined && shown.some((record) => newestFirst(record, last) > 0);
  return { records, more: beyond ? shownMore : page.more };
}

function usableLocale(locale: string | null): locale is string {
  if (locale === null || locale === "") return false;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

// What the Records window starts from, as the Rust core wrote it into the
// page's address (src-tauri/src/records_window.rs, page_url). Anything missing
// or unusable falls back: the default list width, English, the language's own
// formats, the computer's time zone.
export function initialRecordsWindow(search: string): { listWidth: number; context: RecordsContext } {
  const params = new URLSearchParams(search);
  const width = Number(params.get("listWidth") ?? Number.NaN);
  const language = params.get("language");
  const resolved = isLanguage(language) ? language : "en";
  const locale = params.get("locale");
  const timeZone = params.get("timeZone");
  return {
    listWidth: Number.isFinite(width)
      ? Math.max(RECORDS_LIST_WIDTH.min, Math.min(RECORDS_LIST_WIDTH.max, width))
      : RECORDS_LIST_WIDTH.default,
    context: {
      language: resolved,
      locale: usableLocale(locale) ? locale : resolved,
      timeZone: timeZone !== null && isKnownTimeZone(timeZone) ? timeZone : null,
    },
  };
}
