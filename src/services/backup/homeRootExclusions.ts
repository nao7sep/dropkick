// Pure exclusion predicate for the ~/.dropkick home-root walk. The backup is
// optimistic — it captures everything under the home root except a small set of
// categories that are re-derivable or are the backup's own output:
//   - logs/     : session logs, not user data
//   - backups/  : our own archives and index (never back up the backups)
//   - *.tmp     : atomic-write temp files (".{name}.{pid}.tmp") mid-rename
// Documents that happen to live in the home root (the default preferences and
// workspace files) are NOT excluded here — they are captured by id and removed
// from the walk by the collector, which knows their absolute paths.

export function isExcludedHomeFile(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const top = segments[0];
  if (top === "logs" || top === "backups") return true;
  const name = segments[segments.length - 1];
  if (name.endsWith(".tmp")) return true;
  return false;
}
