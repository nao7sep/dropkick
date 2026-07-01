// Discovers what to back up. Two sources feed one candidate list:
//   1. The known documents — preferences, workspace, and the workspace's open
//      task lists — captured by their stable id wherever they live on disk.
//   2. A recursive walk of the ~/.dropkick home root, mirrored onto the archive
//      root, minus the exclusion categories and minus any document that happens
//      to live in the home root (those are already captured by id above).
// The collector does the filesystem reads; the change decision is left to the
// pure plan. It never throws — an unreadable file becomes a recorded skip.

import {
  fileMetadata,
  listFilesRecursive,
  readTextFileContent,
  withSerial,
  joinPath,
} from "../../repositories";
import type { WalkedFile } from "../../repositories";
import type { BackupCandidate, BackupSkip } from "./backupTypes";
import {
  preferencesArchivePath,
  workspaceArchivePath,
  taskListArchivePath,
  homeArchivePath,
} from "./archivePaths";
import { isExcludedHomeFile } from "./homeRootExclusions";

// Everything the collector needs, gathered by the service from the app stores so
// the collector itself stays free of store imports (and easy to test).
export interface BackupInputs {
  homeRoot: string;
  preferences: { path: string; id: string };
  workspace: { path: string; id: string };
  taskListPaths: string[]; // absolute paths of the workspace's open task lists
}

export interface CollectResult {
  candidates: BackupCandidate[];
  skips: BackupSkip[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

// The path relative to `root` (forward-slash) when `path` is under it, else null.
function relativeUnder(root: string, path: string): string | null {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length).split(/[/\\]/).join("/");
}

function parseTaskListId(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { id?: unknown };
    return typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null;
  } catch {
    return null;
  }
}

export async function collectCandidates(
  inputs: BackupInputs,
): Promise<CollectResult> {
  const candidates: BackupCandidate[] = [];
  const skips: BackupSkip[] = [];

  // Documents added first so their id-keyed slots win any case-fold tie against a
  // mirrored home-root path in dedupeCaseInsensitive.

  // 1. Preferences.
  try {
    const meta = await fileMetadata(inputs.preferences.path);
    candidates.push({
      sourcePath: inputs.preferences.path,
      archivePath: preferencesArchivePath(inputs.preferences.id),
      sizeBytes: meta.size,
      mtimeMs: meta.mtimeMs,
    });
  } catch (error) {
    skips.push({ sourcePath: inputs.preferences.path, reason: describeError(error) });
  }

  // 2. Workspace (filename kept inside its id directory).
  try {
    const meta = await fileMetadata(inputs.workspace.path);
    candidates.push({
      sourcePath: inputs.workspace.path,
      archivePath: workspaceArchivePath(
        inputs.workspace.id,
        basename(inputs.workspace.path),
      ),
      sizeBytes: meta.size,
      mtimeMs: meta.mtimeMs,
    });
  } catch (error) {
    skips.push({ sourcePath: inputs.workspace.path, reason: describeError(error) });
  }

  // 3. Task lists — the id lives in the file, so read content here (also reused
  // for the archive entry, avoiding a second read). A list without a materialized
  // id is skipped; it gets one the next time the app loads it, then is captured.
  for (const path of inputs.taskListPaths) {
    try {
      // Stat and read together in the file's serial slot, so size/mtime and the
      // archived bytes are one coherent snapshot, ordered against any in-flight
      // write to this task list (the same guard the store's writes use).
      const { meta, content } = await withSerial(path, async () => ({
        meta: await fileMetadata(path),
        content: await readTextFileContent(path),
      }));
      const id = parseTaskListId(content);
      if (id === null) {
        skips.push({ sourcePath: path, reason: "task list has no id yet" });
        continue;
      }
      candidates.push({
        sourcePath: path,
        archivePath: taskListArchivePath(inputs.workspace.id, id),
        sizeBytes: meta.size,
        mtimeMs: meta.mtimeMs,
        content,
      });
    } catch (error) {
      skips.push({ sourcePath: path, reason: describeError(error) });
    }
  }

  // 4. Home-root walk. Skip the exclusion categories and any document already
  // captured by id above (its default lives in the home root).
  const documentRelPaths = new Set<string>();
  for (const documentPath of [
    inputs.preferences.path,
    inputs.workspace.path,
    ...inputs.taskListPaths,
  ]) {
    const rel = relativeUnder(inputs.homeRoot, documentPath);
    if (rel !== null) documentRelPaths.add(rel.toLowerCase());
  }

  let walked: WalkedFile[] = [];
  try {
    walked = await listFilesRecursive(inputs.homeRoot);
  } catch (error) {
    skips.push({ sourcePath: inputs.homeRoot, reason: describeError(error) });
  }
  for (const file of walked) {
    if (isExcludedHomeFile(file.relativePath)) continue;
    if (documentRelPaths.has(file.relativePath.toLowerCase())) continue;
    candidates.push({
      sourcePath: joinPath(inputs.homeRoot, file.relativePath),
      archivePath: homeArchivePath(file.relativePath),
      sizeBytes: file.size,
      mtimeMs: file.mtimeMs,
    });
  }

  return { candidates, skips };
}
