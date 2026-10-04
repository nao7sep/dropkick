// The Records window's half of the native side. The Rust core opens the window
// (src-tauri/src/records_window.rs) and reads records.sqlite3 off the UI thread
// (src-tauri/src/records.rs); the main window, which owns the interface
// settings and state.json, and the Records window talk through events.

import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import type { ThemePreference } from "../models";
import type {
  RecordDetail,
  RecordsContext,
  RecordSources,
  RecordsPage,
  RecordsQuery,
} from "../models/records";
import { subscribe } from "./events";

const MAIN_WINDOW = "main";
// records_window::LABEL.
const RECORDS_WINDOW = "records";

// records_window::CHANGED_EVENT: a record was stored.
const RECORDS_CHANGED = "records-changed";
// The main window's interface settings changed.
const RECORDS_CONTEXT = "records-context";
// A list-pane drag ended at this width.
const RECORDS_LIST_WIDTH = "records-list-width";

// What the main window opens the Records window with (records_window.rs,
// RecordsWindowContext).
export interface RecordsWindowOpening extends RecordsContext {
  minWidth: number;
  minHeight: number;
  listWidth: number;
  theme: ThemePreference;
}

export async function openRecordsWindow(opening: RecordsWindowOpening): Promise<void> {
  await invoke<void>("open_records_window", { context: opening });
}

export function readRecordsPage(query: RecordsQuery): Promise<RecordsPage> {
  return invoke<RecordsPage>("read_records_page", { query });
}

export function readRecordSources(): Promise<RecordSources> {
  return invoke<RecordSources>("read_record_sources");
}

export function readRecordDetail(id: number): Promise<RecordDetail | null> {
  return invoke<RecordDetail | null>("read_record_detail", { id });
}

export function onRecordsChanged(listener: () => void): () => void {
  return subscribe<null>(RECORDS_CHANGED, () => listener());
}

// The main window tells the Records window, when it is open, about a change.
export async function sendRecordsContext(context: RecordsContext): Promise<void> {
  await emitTo(RECORDS_WINDOW, RECORDS_CONTEXT, context);
}

export function onRecordsContext(listener: (context: RecordsContext) => void): () => void {
  return subscribe<RecordsContext>(RECORDS_CONTEXT, listener);
}

// The Records window hands a dragged width to the main window, which owns
// state.json and persists it.
export async function commitRecordsListWidth(width: number): Promise<void> {
  await emitTo(MAIN_WINDOW, RECORDS_LIST_WIDTH, width);
}

export function onRecordsListWidthCommitted(listener: (width: number) => void): () => void {
  return subscribe<number>(RECORDS_LIST_WIDTH, listener);
}
