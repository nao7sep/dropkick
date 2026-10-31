// Every file Dropkick writes in its own formats starts with the file identity
// header (file-identity-conventions): `format` says what it is (owner, kind,
// version) and `writer` which build saved it. Each kind's version lives in a
// JSON table so the Rust core reads the same numbers (its format_version
// module, which judges the files the core reads the same way).
import FORMAT_VERSION_TABLE from "./format-versions.json";
import { name as PACKAGE_NAME, version as APP_VERSION } from "../../package.json";

// A store's format, by its key in the table.
export type StoreFormat = keyof typeof FORMAT_VERSION_TABLE;

// The header's `kind` for a format: its key in lowercase kebab-case
// (`taskList` is `task-list`).
export function formatKind(format: StoreFormat): string {
  return format.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export const FORMAT_VERSIONS: Readonly<Record<StoreFormat, number>> = FORMAT_VERSION_TABLE;

// The product that owns every format here.
export const OWNER = "dropkick";

// This build, as every save writes it. It is never read back.
export const WRITER = { name: PACKAGE_NAME, version: APP_VERSION } as const;

// What a parsed document's header says about it. A document is readable only
// when `format` names this owner and the expected kind, so a task list opened
// as a workspace, or the reverse, is unreadable whatever its version. A
// missing or malformed header is unreadable: nothing infers a format from a
// file's shape. `writer` is not looked at.
export type FileHeaderCheck =
  | { status: "readable" }
  | { status: "newer"; formatVersion: number }
  | { status: "invalid"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkFileHeader(data: unknown, format: StoreFormat): FileHeaderCheck {
  const header = isRecord(data) ? data.format : undefined;
  if (!isRecord(header)) return { status: "invalid", message: "format is missing or not an object" };
  const { owner, kind, version } = header;
  if (typeof owner !== "string" || typeof kind !== "string") {
    return { status: "invalid", message: "format.owner or format.kind is missing or not a string" };
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { status: "invalid", message: "format.version is missing or not a positive integer" };
  }
  if (owner !== OWNER || kind !== formatKind(format)) {
    return { status: "invalid", message: `file is ${owner} ${kind}, not ${OWNER} ${formatKind(format)}` };
  }
  return version > FORMAT_VERSIONS[format]
    ? { status: "newer", formatVersion: version }
    : { status: "readable" };
}

// The document as written: its header first, then its body. The header is
// spread again after the body so a body carrying its own copy can neither
// replace it nor move it.
export function withFileHeader(format: StoreFormat, document: object): Record<string, unknown> {
  const header = {
    format: { owner: OWNER, kind: formatKind(format), version: FORMAT_VERSIONS[format] },
    writer: { ...WRITER },
  };
  return { ...header, ...document, ...header };
}

// Why a load-time store came up without its file: set aside as unreadable, or
// left in place because a newer build wrote it.
export type StoreRecovery =
  | { kind: "quarantined"; quarantinedTo: string }
  | { kind: "newer"; formatVersion: number };
