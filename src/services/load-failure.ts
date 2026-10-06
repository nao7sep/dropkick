import type { MessageKey } from "../i18n/catalogues";
import { message, type Message } from "../i18n/translate";

// The user-facing wording for a document that would not load, and the file-name
// label that goes with it.
//
// Both were module-private copies in five and three places respectively, which
// had already drifted: two different fallbacks for the same file name, and one
// message variant that dropped the path. Each copy handled `missing` explicitly
// and let everything else fall through to one generic string, so adding a
// status to a result union compiles clean while some surfaces say the wrong
// thing about it.

// The non-success arms every document loader shares, and the one only a task
// list has: its list is already open from another file, so one of the two is
// a copy and it is not opened beside the other.
export type LoadFailure =
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "newer"; formatVersion: number }
  | { status: "error"; message: string }
  | { status: "duplicate"; path: string; otherPath: string };

// What kind of document failed. Each kind has whole sentences of its own, so
// no language has to fit a document name into a shared frame.
export type DocumentKind = "taskList" | "preferences" | "workspace";

// One message for a failed load. `path` is omitted where the surface already
// shows it — an inline banner inside the tab for that very file.
export function describeLoadFailure(
  kind: DocumentKind,
  result: LoadFailure,
  path?: string,
): Message {
  if (result.status === "duplicate") {
    return message("load.taskList.duplicate", { path: result.path, otherPath: result.otherPath });
  }
  const key = `load.${kind}.${result.status}${path ? "At" : ""}` as MessageKey;
  return path ? message(key, { path }) : message(key);
}

// One message for a note drafts file that exists but cannot be used. The file
// is never set aside, so the message names it: the user repairs or moves it,
// then tries again.
export function describeNoteDraftsFailure(
  result: Exclude<LoadFailure, { status: "missing" | "duplicate" }>,
  path: string,
): Message {
  return message(`load.noteDrafts.${result.status}`, { path });
}

// One message for an open task list whose file, changed on disk, could not be
// read back, shown above the copy still loaded.
export function describeDiskFailure(result: LoadFailure): Message {
  if (result.status === "duplicate") {
    return message("taskList.disk.duplicate", { path: result.path, otherPath: result.otherPath });
  }
  return message(`taskList.disk.${result.status}`);
}

// A file path's base name without its .json extension, used as a document's
// display label. `split` always yields at least one element, so the fallbacks
// the copies carried were unreachable.
export function fileNameWithoutExt(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1].replace(/\.json$/, "");
}
