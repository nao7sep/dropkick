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

// The non-success arms every document loader shares.
export type LoadFailure =
  | { status: "missing" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string };

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
  const key = `load.${kind}.${result.status}${path ? "At" : ""}` as MessageKey;
  return path ? message(key, { path }) : message(key);
}

// A file path's base name without its .json extension, used as a document's
// display label. `split` always yields at least one element, so the fallbacks
// the copies carried were unreachable.
export function fileNameWithoutExt(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1].replace(/\.json$/, "");
}
