// Orchestrates one backup run: load the index, collect candidates, drop
// case-collisions, select the changed ones, write the archive, then write the
// index. The write order is load-bearing — the archive lands (atomically) first,
// and only a fully written archive gets recorded, so a crash between the two
// leaves an orphaned archive that the next run simply recaptures, never a phantom
// index row. The engine never throws for expected trouble; it returns a report.

import {
  readJsonFileResult,
  writeJsonFile,
  writeZipArchive,
  readTextFileContent,
  withSerial,
  joinPath,
  fileExists,
} from "../../repositories";
import type {
  BackupIndex,
  BackupReport,
  BackupSkip,
  BackupCandidate,
} from "./backupTypes";
import { collectCandidates, type BackupInputs } from "./backupCollector";
import { dedupeCaseInsensitive } from "./archivePaths";
import { selectChanged } from "./backupPlan";
import { backupTimestamp, toIsoSeconds } from "./backupTime";

const BACKUPS_DIR_NAME = "backups";
const INDEX_FILE_NAME = "index.json";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Loads the index. A missing index is a normal first run (empty). A corrupt or
// unreadable one is reset to empty — the run then recaptures everything and
// overwrites the bad file, rather than trusting a ledger it cannot parse.
async function readIndex(
  indexPath: string,
): Promise<{ index: BackupIndex; wasReset: boolean }> {
  const result = await readJsonFileResult<BackupIndex>(indexPath);
  if (result.status === "missing") return { index: { entries: [] }, wasReset: false };
  if (result.status === "success" && Array.isArray(result.data?.entries)) {
    return { index: { entries: result.data.entries }, wasReset: false };
  }
  return { index: { entries: [] }, wasReset: true };
}

// The archive's name is derived from a millisecond timestamp, so two runs that
// land in the same millisecond — a fast backup cadence, or a caller-supplied
// clock — would otherwise both resolve to the same `backup-<stamp>.zip`, and
// the Rust write (an unconditional rename into place) would silently clobber
// the earlier archive. Per the data-backup convention, a create must never
// clobber: before writing, probe for the candidate name and, if it is taken,
// advance by one millisecond and try again until a free stamp is found. The
// winning stamp is used for both the zip's file name and the index rows this
// run appends, so the two stay in lockstep with what actually landed on disk.
async function resolveFreeArchiveStamp(
  backupsDir: string,
  nowMs: number,
): Promise<{ archivedAt: string; archiveFileName: string }> {
  let candidateMs = nowMs;
  for (;;) {
    const archivedAt = backupTimestamp(candidateMs);
    const archiveFileName = `backup-${archivedAt}.zip`;
    if (!(await fileExists(joinPath(backupsDir, archiveFileName)))) {
      return { archivedAt, archiveFileName };
    }
    candidateMs += 1;
  }
}

export async function runBackup(
  inputs: BackupInputs,
  nowMs: number,
): Promise<BackupReport> {
  const skips: BackupSkip[] = [];
  let indexWasReset = false;
  try {
    const backupsDir = joinPath(inputs.homeRoot, BACKUPS_DIR_NAME);
    const indexPath = joinPath(backupsDir, INDEX_FILE_NAME);

    const loaded = await readIndex(indexPath);
    const index = loaded.index;
    indexWasReset = loaded.wasReset;

    const collected = await collectCandidates(inputs);
    skips.push(...collected.skips);

    const { kept, dropped } = dedupeCaseInsensitive(collected.candidates);
    for (const collision of dropped) {
      skips.push({
        sourcePath: collision.sourcePath,
        reason: `case-insensitive archive-path collision: ${collision.archivePath}`,
      });
    }

    const changed = selectChanged(kept, index);

    // Materialize the archive entries. Files read during collection (task lists)
    // already carry content; everything else is read now, inside its per-path
    // serial slot so the bytes are a coherent snapshot, never mid-write.
    const entries: [string, string][] = [];
    const archived: BackupCandidate[] = [];
    for (const candidate of changed) {
      let content = candidate.content;
      if (content === undefined) {
        try {
          content = await withSerial(candidate.sourcePath, () =>
            readTextFileContent(candidate.sourcePath),
          );
        } catch (error) {
          skips.push({ sourcePath: candidate.sourcePath, reason: describeError(error) });
          continue;
        }
      }
      entries.push([candidate.archivePath, content]);
      archived.push(candidate);
    }

    if (entries.length === 0) {
      return {
        nothingChanged: true,
        archiveFileName: null,
        filesArchived: 0,
        skips,
        indexWasReset,
        fatal: null,
      };
    }

    const { archivedAt, archiveFileName } = await resolveFreeArchiveStamp(backupsDir, nowMs);

    // Archive first...
    await writeZipArchive(entries, joinPath(backupsDir, archiveFileName));

    // ...then record it. Append one row per archived file (the index keeps
    // history; the plan reads the latest row per path).
    const updatedIndex: BackupIndex = { entries: [...index.entries] };
    for (const candidate of archived) {
      updatedIndex.entries.push({
        archivedAt,
        archivePath: candidate.archivePath,
        sizeBytes: candidate.sizeBytes,
        lastWriteUtc: toIsoSeconds(candidate.mtimeMs),
      });
    }
    await writeJsonFile(indexPath, updatedIndex);

    return {
      nothingChanged: false,
      archiveFileName,
      filesArchived: archived.length,
      skips,
      indexWasReset,
      fatal: null,
    };
  } catch (error) {
    return {
      nothingChanged: false,
      archiveFileName: null,
      filesArchived: 0,
      skips,
      indexWasReset,
      fatal: describeError(error),
    };
  }
}
