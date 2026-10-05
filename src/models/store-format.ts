// Every store's format version (store-recovery-conventions): one integer per
// format, independent of the app's version and of the other formats. The table
// is JSON so the Rust core reads the same numbers (src-tauri/src/format_version.rs).
import FORMAT_VERSION_TABLE from "./format-versions.json";

export type StoreFormat = keyof typeof FORMAT_VERSION_TABLE;

export const FORMAT_VERSIONS: Readonly<Record<StoreFormat, number>> = FORMAT_VERSION_TABLE;

// What a parsed document's marker says about it. A document that is not an
// object is left to its loader's own shape check.
export type FormatVersionCheck =
  | { status: "readable" }
  | { status: "newer"; formatVersion: number }
  | { status: "invalid"; message: string };

export function checkFormatVersion(data: unknown, format: StoreFormat): FormatVersionCheck {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { status: "readable" };
  }
  const document = data as Record<string, unknown>;
  const found = Object.prototype.hasOwnProperty.call(document, "formatVersion")
    ? document.formatVersion
    : 1;
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    return { status: "invalid", message: "formatVersion is not a positive integer" };
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
