// Pure backup naming and GFS-rotation logic.
//
// This module has NO Tauri or filesystem dependencies so the rules can be unit
// tested in isolation. backup.ts handles the actual I/O and delegates the
// decisions here.

export const MS_HOUR = 60 * 60 * 1000;
export const MS_DAY = 24 * MS_HOUR;
export const MS_WEEK = 7 * MS_DAY;

// Windows reserved filenames that cannot be used as zip entry names.
const WINDOWS_RESERVED = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

// Normalizes a string to NFC and sanitizes for cross-platform zip entry names.
export function sanitizeEntryName(name: string): string {
  // Normalize Unicode to NFC (macOS uses NFD on APFS).
  let result = name.normalize("NFC");

  // Replace characters invalid on Windows.
  result = result.replace(/[<>:"/\\|?*]/g, "_");

  // Check for Windows reserved names (without extension).
  const baseLower = result.replace(/\.[^.]+$/, "").toLowerCase();
  if (WINDOWS_RESERVED.has(baseLower)) {
    result = `_${result}`;
  }

  return result;
}

// Resolves unique zip entry names for a list of file paths.
// Algorithm: start with filename (no extension). If conflicts exist,
// append parent directory names one level at a time until all names are unique.
// All names are NFC-normalized before conflict detection.
export function resolveEntryNames(paths: string[]): Map<string, string> {
  const unique = [...new Set(paths)];

  const parsed = unique.map((p) => {
    const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
    const fileName = segments[segments.length - 1] ?? "unknown";
    // NFC-normalize all path segments for consistent comparison.
    const baseName = fileName.replace(/\.[^.]+$/, "").normalize("NFC");
    const extension = fileName.includes(".")
      ? fileName.slice(fileName.lastIndexOf("."))
      : "";
    const parents = segments
      .slice(0, -1)
      .reverse()
      .map((s) => s.normalize("NFC"));
    return { path: p, baseName, extension, parents, levels: 0 };
  });

  // Iteratively resolve conflicts using NFC-normalized, case-insensitive comparison.
  for (let round = 0; round < 50; round++) {
    const names = parsed.map((entry) => {
      const suffixParts = entry.parents.slice(0, entry.levels).reverse();
      return [entry.baseName, ...suffixParts].join("-").toLowerCase();
    });

    const counts = new Map<string, number[]>();
    names.forEach((name, i) => {
      const group = counts.get(name) ?? [];
      group.push(i);
      counts.set(name, group);
    });

    let hasConflicts = false;
    for (const [, indices] of counts) {
      if (indices.length > 1) {
        hasConflicts = true;
        for (const i of indices) {
          if (parsed[i].levels < parsed[i].parents.length) {
            parsed[i].levels++;
          }
        }
      }
    }

    if (!hasConflicts) break;
  }

  const result = new Map<string, string>();
  for (const entry of parsed) {
    const suffixParts = entry.parents.slice(0, entry.levels).reverse();
    const raw = [entry.baseName, ...suffixParts].join("-");
    result.set(entry.path, sanitizeEntryName(`${raw}${entry.extension}`));
  }

  return result;
}

// Generates a UTC timestamp string for backup filenames.
export function backupTimestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    "-",
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    "-utc",
  ].join("");
}

// Parses a backup filename into a UTC timestamp (milliseconds since epoch).
// Expected format: backup-YYYYMMDD-HHMMSS-utc.zip
export function parseBackupUtcMs(filename: string): number | null {
  const match = filename.match(
    /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-utc\.zip$/,
  );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
}

// Pure GFS selection: given backup filenames and the current time, decides which
// to keep and which to delete.
//
// UTC-aligned sliding windows:
//   - 0–24 hours old: keep one per UTC hour
//   - 1–7 days old:   keep one per UTC day
//   - 7–30 days old:  keep one per UTC week
//   - older than 30 days: delete
// Unrecognized filenames are ignored entirely (neither kept nor deleted).
export function selectBackupsToPrune(
  filenames: string[],
  nowMs: number,
): { keep: string[]; deleteList: string[] } {
  const backups: { name: string; ms: number }[] = [];
  for (const f of filenames) {
    const ms = parseBackupUtcMs(f);
    if (ms !== null) backups.push({ name: f, ms });
  }

  // Sort newest first so each slot keeps its most recent backup.
  backups.sort((a, b) => b.ms - a.ms);

  const keep = new Set<string>();

  const hourSlot = (ms: number) => Math.floor(ms / MS_HOUR);
  const daySlot = (ms: number) => Math.floor(ms / MS_DAY);
  const weekSlot = (ms: number) => Math.floor(ms / MS_WEEK);

  // Bucket 1: last 24 hours — keep one per hour.
  const hourSlots = new Map<number, string>();
  for (const b of backups) {
    const age = nowMs - b.ms;
    if (age > MS_DAY) continue;
    const slot = hourSlot(b.ms);
    if (!hourSlots.has(slot)) hourSlots.set(slot, b.name);
  }
  for (const name of hourSlots.values()) keep.add(name);

  // Bucket 2: last 7 days (excluding last 24h) — keep one per day.
  const daySlots = new Map<number, string>();
  for (const b of backups) {
    const age = nowMs - b.ms;
    if (age <= MS_DAY || age > MS_WEEK) continue;
    const slot = daySlot(b.ms);
    if (!daySlots.has(slot)) daySlots.set(slot, b.name);
  }
  for (const name of daySlots.values()) keep.add(name);

  // Bucket 3: last 30 days (excluding last 7 days) — keep one per week.
  const weekSlots = new Map<number, string>();
  for (const b of backups) {
    const age = nowMs - b.ms;
    if (age <= MS_WEEK || age > 30 * MS_DAY) continue;
    const slot = weekSlot(b.ms);
    if (!weekSlots.has(slot)) weekSlots.set(slot, b.name);
  }
  for (const name of weekSlots.values()) keep.add(name);

  const deleteList = backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
  return { keep: [...keep], deleteList };
}
