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
  quarantineFile,
  appPaths,
  withSerial,
} from "./file-system";
import { log, toErrorFields } from "./logging";


export interface LoadNoteDraftsResult {
  drafts: Record<string, string>;
  // Empty when the file could not be read at all. The store treats that as
  // "persistence disabled for this session" rather than writing over bytes it
  // failed to read (storage-path conventions: never reset defaults over bytes
  // that may carry the user's work).
  filePath: string;
  // Set when a present-but-unreadable file was renamed aside. The caller uses
  // this only to decide whether to show recovery copy; the path stays in logs.
  quarantinedTo: string | null;
}

// Returns null when the value is a usable drafts document, or the reason it is
// not. Every draft value must be a string; a malformed one would otherwise be
// re-emitted on the next write or land in a textarea as an object.
function noteDraftsShapeIssue(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "note-drafts root is not an object";
  }

  const data = value as Record<string, unknown>;
  if (data.version !== undefined && typeof data.version !== "string") {
    return "version is not a string";
  }

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
// empty map. A present-but-unreadable file is quarantined and reported, never
// silently overwritten. A file that cannot be read at all (permissions, I/O)
// leaves `filePath` empty so the session keeps drafts in memory and writes
// nothing over the bytes it could not read.
export async function loadNoteDrafts(): Promise<LoadNoteDraftsResult> {
  const { noteDraftsFile: filePath } = await appPaths();
  const result = await readJsonFileResult<unknown>(filePath);

  if (result.status === "missing") {
    return { drafts: {}, filePath, quarantinedTo: null };
  }

  if (result.status === "error") {
    log.warn("note drafts unreadable; drafts will not persist this session", {
      filePath,
      message: result.message,
    });
    return { drafts: {}, filePath: "", quarantinedTo: null };
  }

  const issue =
    result.status === "invalid"
      ? result.message
      : noteDraftsShapeIssue(result.data);

  if (issue !== null) {
    // The rename runs OUTSIDE the read-failure handling, so a failed quarantine
    // disables persistence instead of falling through to a write over the bytes
    // it exists to preserve.
    try {
      const quarantinedTo = await quarantineFile(filePath);
      log.warn("corrupt note-drafts.json quarantined; starting empty", {
        filePath,
        quarantinedTo,
        issue,
      });
      return { drafts: {}, filePath, quarantinedTo };
    } catch (e) {
      log.error("note-drafts quarantine failed; drafts will not persist this session", {
        filePath,
        issue,
        ...toErrorFields(e),
      });
      return { drafts: {}, filePath: "", quarantinedTo: null };
    }
  }

  const data = result.status === "success" ? (result.data as Partial<NoteDraftsDto>) : {};
  return {
    drafts: { ...(data.drafts ?? {}) },
    filePath,
    quarantinedTo: null,
  };
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
    await writeJsonFile(filePath, document);
  });
}
