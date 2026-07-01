// Pure exclusion predicate for the ~/.dropkick home-root walk. The backup is
// optimistic — it captures everything under the home root except a small set of
// categories that are re-derivable or are the backup's own output:
//   - logs/     : session logs, not user data
//   - backups/  : our own archives and index (never back up the backups)
//   - *.tmp     : atomic-write temp files (".{name}.{pid}.tmp") mid-rename
//   - state.json: volatile session bookkeeping (recent files, open tabs, last
//     paths) — not durable user work, so excluded per the content-based rule.
//   - OS/file-manager metadata a file manager drops into any browsed directory
//     (.DS_Store, Thumbs.db, desktop.ini) — the fleet floor, matched case-insensitively.
// Documents that happen to live in the home root (the default preferences and
// workspace files) are NOT excluded here — they are captured by id and removed
// from the walk by the collector, which knows their absolute paths. (The Rust
// walker reports directory-entry types without following symlinks, so a link is
// never followed or archived.)

export function isExcludedHomeFile(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const top = segments[0];
  if (top === "logs" || top === "backups") return true;
  if (relativePath === "state.json") return true;
  const lower = segments[segments.length - 1].toLowerCase();
  if (lower.endsWith(".tmp")) return true;
  if (lower === ".ds_store" || lower === "thumbs.db" || lower === "desktop.ini") return true;
  return false;
}
