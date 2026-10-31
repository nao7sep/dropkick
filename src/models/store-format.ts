// Every store's format version (store-recovery-conventions): one integer per
// format, independent of the app's version and of the other formats. The table
// is JSON so the Rust core reads the same numbers (its format_version module).
import FORMAT_VERSION_TABLE from "./format-versions.json";
import { version as APP_VERSION } from "../../package.json";

export type StoreFormat = keyof typeof FORMAT_VERSION_TABLE;

export const FORMAT_VERSIONS: Readonly<Record<StoreFormat, number>> = FORMAT_VERSION_TABLE;

// The documents a user keeps in their own folders say what they are and what
// wrote them, right after the marker. Every save writes this build's version.
// Mirrored in the Rust core's format_version module, which reads task lists.
const DOCUMENT_KINDS: Partial<Record<StoreFormat, string>> = {
  workspace: "workspace",
  taskList: "taskList",
};

export const WRITER = { name: "dropkick", version: APP_VERSION } as const;

function isWriter(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const writer = value as Record<string, unknown>;
  return typeof writer.name === "string" && writer.name !== ""
    && typeof writer.version === "string" && writer.version !== "";
}

// What a parsed document's marker says about it. A document without its
// marker is unreadable: nothing infers a version from a file's shape. A user
// document must also name its own kind and a writer, so a task list opened as
// a workspace, or the reverse, is unreadable too.
export type FormatVersionCheck =
  | { status: "readable" }
  | { status: "newer"; formatVersion: number }
  | { status: "invalid"; message: string };

export function checkFormatVersion(data: unknown, format: StoreFormat): FormatVersionCheck {
  const found = typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>).formatVersion
    : undefined;
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    return { status: "invalid", message: "formatVersion is missing or not a positive integer" };
  }
  if (found > FORMAT_VERSIONS[format]) return { status: "newer", formatVersion: found };
  const kind = DOCUMENT_KINDS[format];
  if (kind !== undefined) {
    const record = data as Record<string, unknown>;
    if (record.kind !== kind) return { status: "invalid", message: `kind is missing or not ${kind}` };
    if (!isWriter(record.writer)) return { status: "invalid", message: "writer is missing or has no name and version" };
  }
  return { status: "readable" };
}

// The document as written: its format's current version first, then a user
// document's kind and writer, then its body. The header is spread again after
// the body so a body carrying its own copy cannot replace it or move it.
export function withFormatVersion(format: StoreFormat, document: object): Record<string, unknown> {
  const kind = DOCUMENT_KINDS[format];
  const header = kind === undefined
    ? { formatVersion: FORMAT_VERSIONS[format] }
    : { formatVersion: FORMAT_VERSIONS[format], kind, writer: { ...WRITER } };
  return { ...header, ...document, ...header };
}

// Why a load-time store came up without its file: set aside as unreadable, or
// left in place because a newer build wrote it.
export type StoreRecovery =
  | { kind: "quarantined"; quarantinedTo: string }
  | { kind: "newer"; formatVersion: number };
