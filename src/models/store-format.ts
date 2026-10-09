// Every store's format version (store-recovery-conventions): one integer per
// format, independent of the app's version and of the other formats. The table
// is JSON so the Rust core reads the same numbers (src-tauri/src/format_version.rs).
import FORMAT_VERSION_TABLE from "./format-versions.json";

export type StoreFormat = keyof typeof FORMAT_VERSION_TABLE;

export const FORMAT_VERSIONS: Readonly<Record<StoreFormat, number>> = FORMAT_VERSION_TABLE;

// The label v0.1.0, the one published release before format markers, wrote
// into every JSON document it saved (developer decision: the next version
// opens those files). Its formats are this build's version 1: the bodies are
// the same shape, and each loader converts what changed meaning. Mirrored in
// src-tauri/src/format_version.rs.
export const V010_LABEL = "1.0.0";

// Whether a parsed document is one v0.1.0 wrote: its label and no marker.
export function isV010Document(data: unknown): data is Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  return record.formatVersion === undefined && record.version === V010_LABEL;
}

// What a parsed document's marker says about it. A document without its
// marker is unreadable, unless it carries v0.1.0's label instead: nothing else
// infers a version from a file's shape.
export type FormatVersionCheck =
  | { status: "readable" }
  | { status: "newer"; formatVersion: number }
  | { status: "invalid"; message: string };

export function checkFormatVersion(data: unknown, format: StoreFormat): FormatVersionCheck {
  if (isV010Document(data)) return { status: "readable" };
  const found = typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>).formatVersion
    : undefined;
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    return { status: "invalid", message: "formatVersion is missing or not a positive integer" };
  }
  return found > FORMAT_VERSIONS[format]
    ? { status: "newer", formatVersion: found }
    : { status: "readable" };
}

// The document as written: its format's current version first, then its body.
export function withFormatVersion(format: StoreFormat, document: object): Record<string, unknown> {
  return { formatVersion: FORMAT_VERSIONS[format], ...document };
}

// Why a load-time store came up without its file: set aside as unreadable, or
// left in place because a newer build wrote it.
export type StoreRecovery =
  | { kind: "quarantined"; quarantinedTo: string }
  | { kind: "newer"; formatVersion: number };
