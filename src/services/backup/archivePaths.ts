// Pure mapping from dropkick's on-disk data to archive entry paths, plus the
// fleet-wide case-insensitive uniqueness guard. Two layouts meet here:
//   - Documents (preferences, workspace, task lists) are keyed by their stable
//     id, so a document keeps one archive slot no matter where it lives on disk
//     or what it is named. The workspace is the container: its id names a
//     directory, its human filename is kept inside, and its task lists nest under
//     it. (See the data-backup convention's container/leaf rules.)
//   - Home-root files mirror their path relative to ~/.dropkick straight onto the
//     archive root.

import type { BackupCandidate } from "./backupTypes";

export function preferencesArchivePath(preferencesId: string): string {
  return `preferences/${preferencesId}.json`;
}

// The workspace's id names its directory; its on-disk filename is kept inside,
// exactly as daynote keeps a binder's filename inside its id directory.
export function workspaceArchivePath(
  workspaceId: string,
  workspaceFileName: string,
): string {
  return `workspaces/${workspaceId}/${workspaceFileName}`;
}

// Task lists are named by id (not their on-disk filename): they live at arbitrary
// paths and two different lists can share a basename, so the id is the only
// collision-free key.
export function taskListArchivePath(
  workspaceId: string,
  taskListId: string,
): string {
  return `workspaces/${workspaceId}/task-lists/${taskListId}.json`;
}

// Home-root files map straight: the path relative to ~/.dropkick is the entry.
export function homeArchivePath(relativePath: string): string {
  return relativePath;
}

// Enforces the hard fleet invariant that no two archive entries differ only in
// case (they would collide on a case-insensitive macOS/Windows filesystem on any
// future extraction). Keeps the first candidate per case-folded path and reports
// the rest as dropped so the engine can record a skip for each. Documents are
// passed before home files, so an id-keyed slot always wins over a mirrored one.
export function dedupeCaseInsensitive(candidates: BackupCandidate[]): {
  kept: BackupCandidate[];
  dropped: BackupCandidate[];
} {
  const seen = new Set<string>();
  const kept: BackupCandidate[] = [];
  const dropped: BackupCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.archivePath.toLowerCase();
    if (seen.has(key)) {
      dropped.push(candidate);
    } else {
      seen.add(key);
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}
