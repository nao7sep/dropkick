// Manages ~/.dropkick/note-drafts.json — the user's uncommitted note text.
//
// Own file, own type, own load/save path, like every other kind this app
// persists (persisted-store-separation conventions). The store above owns the
// draft map and the write cadence; this module owns I/O only.

import type { NoteDraftsDto } from "../models";
import { createDefaultNoteDrafts } from "../models";
import {
  readJsonFileResult,
  writeJsonFile,
  appPaths,
  withSerial,
} from "./file-system";

// A drafts file that exists but cannot be used. Drafts are the user's own
// unsaved text and nothing else holds them, so the load halts and the file is
// left exactly in place (store-recovery-conventions).
export type NoteDraftsLoadFailure =
  | { status: "invalid"; message: string; filePath: string }
  | { status: "newer"; formatVersion: number; filePath: string }
  | { status: "error"; message: string; filePath: string };

export type LoadNoteDraftsResult =
  | { status: "success"; drafts: Record<string, string>; filePath: string }
  | NoteDraftsLoadFailure;

// Returns null when the value is a usable drafts document, or the reason it is
// not. Every draft value must be a string; a malformed one would otherwise be
// re-emitted on the next write or land in a textarea as an object.
function noteDraftsShapeIssue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "note-drafts root is not an object";
  }

  const data = value as Record<string, unknown>;
  const drafts = data.drafts;
  if (drafts === undefined) return null;
  if (typeof drafts !== "object" || drafts === null || Array.isArray(drafts)) {
    return "drafts is not an object";
  }
  for (const [key, text] of Object.entries(drafts as Record<string, unknown>)) {
    if (typeof text !== "string") return `draft "${key}" is not a string`;
  }

  return null;
}

// Reads the drafts file. Missing is the normal first-run case and yields an
// empty map. Every other outcome that is not usable drafts is returned as a
// failure with the file untouched.
export async function loadNoteDrafts(): Promise<LoadNoteDraftsResult> {
  const { noteDraftsFile: filePath } = await appPaths();
  const result = await readJsonFileResult<unknown>(filePath, "noteDrafts");

  if (result.status === "missing") {
    return { status: "success", drafts: {}, filePath };
  }
  if (result.status === "newer") {
    return { status: "newer", formatVersion: result.formatVersion, filePath };
  }
  if (result.status === "error" || result.status === "invalid") {
    return { status: result.status, message: result.message, filePath };
  }

  const issue = noteDraftsShapeIssue(result.data);
  if (issue !== null) {
    return { status: "invalid", message: issue, filePath };
  }

  const data = result.data as Partial<NoteDraftsDto>;
  return { status: "success", drafts: { ...(data.drafts ?? {}) }, filePath };
}

// Writes the latest drafts to disk. Serialized per path like every other store,
// so overlapping coalesced writes can never land out of order, and `getDrafts`
// runs inside the serial slot so it sees the newest text at the instant of the
// write.
export async function flushNoteDrafts(
  filePath: string,
  getDrafts: () => Record<string, string>,
): Promise<void> {
  await withSerial(filePath, async () => {
    const document: NoteDraftsDto = {
      ...createDefaultNoteDrafts(),
      drafts: getDrafts(),
    };
    await writeJsonFile(filePath, "noteDrafts", document);
  });
}
