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

// What kind of document failed, in the words the message uses.
export type DocumentKind = "task list" | "preferences" | "workspace";

// One sentence for a failed load. `path` is omitted where the surface already
// shows it — an inline banner inside the tab for that very file.
export function describeLoadFailure(
  kind: DocumentKind,
  result: LoadFailure,
  path?: string,
): string {
  if (result.status === "missing") {
    return `The ${kind} file could not be found${path ? `:\n\n${path}` : "."}`;
  }
  if (result.status === "invalid") {
    return `The ${kind} file does not contain valid Dropkick data${path ? `:\n\n${path}` : "."}`;
  }
  return `The ${kind} file could not be read${path ? `:\n\n${path}` : "."} Check that it is still available and that Dropkick has access, then try again.`;
}

// A file path's base name without its .json extension, used as a document's
// display label. `split` always yields at least one element, so the fallbacks
// the copies carried were unreachable.
export function fileNameWithoutExt(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1].replace(/\.json$/, "");
}
