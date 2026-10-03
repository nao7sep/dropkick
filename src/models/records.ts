// What the Records window reads from records.sqlite3 (src-tauri/src/records.rs):
// a filtered page of summaries, newest first, and one record whole. A record's
// other fields arrive as the JSON text the database holds; the window decides
// how to show them.

import type { Language } from "../i18n/languages";

export type RecordLevel = "debug" | "info" | "warn" | "error";

export const RECORD_LEVELS: readonly RecordLevel[] = ["error", "warn", "info", "debug"];

// What the level filter offers: a record's own level, or `attention`, every
// record at `warn` or `error`.
export type RecordLevelFilter = "attention" | RecordLevel;

export const RECORD_LEVEL_FILTERS: readonly RecordLevelFilter[] = ["attention", ...RECORD_LEVELS];

// Where the next page starts: the last summary of the page before it.
export interface RecordCursor {
  time: string;
  id: number;
}

export interface RecordsQuery {
  // A launch, named by its session.
  session: string | null;
  level: RecordLevelFilter | null;
  search: string;
  after: RecordCursor | null;
}

export interface RecordSummary {
  id: number;
  session: string;
  time: string;
  level: RecordLevel;
  message: string;
  taskId: string | null;
}

export interface RecordsPage {
  records: RecordSummary[];
  more: boolean;
}

export interface RecordDetail extends RecordSummary {
  // Every other field of the entry, as JSON text.
  fields: string;
}

// The values the launch filter offers: every launch that has records, newest
// first, and this one.
export interface RecordSources {
  currentSession: string | null;
  sessions: string[];
}

// The interface settings the main window holds and the Records window speaks:
// the language, the locale dates are formatted in, and the app's time zone
// (null for the computer's own).
export interface RecordsContext {
  language: Language;
  locale: string;
  timeZone: string | null;
}
