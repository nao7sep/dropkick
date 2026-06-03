import { describe, it, expect } from "vitest";
import {
  MS_HOUR,
  MS_DAY,
  MS_WEEK,
  sanitizeEntryName,
  resolveEntryNames,
  backupTimestamp,
  parseBackupUtcMs,
  selectBackupsToPrune,
} from "./backup-rotation";

describe("sanitizeEntryName", () => {
  it("replaces Windows-invalid characters with underscores", () => {
    expect(sanitizeEntryName('a<b>c:d"e/f\\g|h?i*j.json')).toBe("a_b_c_d_e_f_g_h_i_j.json");
  });

  it("prefixes Windows reserved base names with an underscore", () => {
    expect(sanitizeEntryName("con.json")).toBe("_con.json");
    expect(sanitizeEntryName("NUL.txt")).toBe("_NUL.txt");
    expect(sanitizeEntryName("com1.json")).toBe("_com1.json");
  });

  it("leaves an ordinary name untouched", () => {
    expect(sanitizeEntryName("tasks.json")).toBe("tasks.json");
  });

  it("normalizes Unicode to NFC", () => {
    // "é" as NFD (e + combining acute) should normalize to a single NFC codepoint.
    const nfd = "café.json";
    const result = sanitizeEntryName(nfd);
    expect(result).toBe("café.json".normalize("NFC"));
    expect(result.normalize("NFC")).toBe(result);
  });
});

describe("resolveEntryNames", () => {
  it("uses the bare filename (no extension) when there is no conflict", () => {
    const map = resolveEntryNames(["/home/u/tasks.json", "/home/u/work.json"]);
    expect(map.get("/home/u/tasks.json")).toBe("tasks.json");
    expect(map.get("/home/u/work.json")).toBe("work.json");
  });

  it("appends parent directories to disambiguate same-named files", () => {
    const map = resolveEntryNames(["/home/projectA/tasks.json", "/home/projectB/tasks.json"]);
    expect(map.get("/home/projectA/tasks.json")).toBe("tasks-projectA.json");
    expect(map.get("/home/projectB/tasks.json")).toBe("tasks-projectB.json");
  });

  it("walks up additional levels when one parent is still ambiguous", () => {
    const map = resolveEntryNames(["/a/shared/tasks.json", "/b/shared/tasks.json"]);
    // Parents are appended outermost-first once more than one level is needed.
    expect(map.get("/a/shared/tasks.json")).toBe("tasks-a-shared.json");
    expect(map.get("/b/shared/tasks.json")).toBe("tasks-b-shared.json");
  });

  it("deduplicates identical paths", () => {
    const map = resolveEntryNames(["/home/u/tasks.json", "/home/u/tasks.json"]);
    expect(map.size).toBe(1);
  });

  it("handles Windows-style backslash separators", () => {
    const map = resolveEntryNames(["C:\\proj\\tasks.json"]);
    expect(map.get("C:\\proj\\tasks.json")).toBe("tasks.json");
  });
});

describe("backupTimestamp / parseBackupUtcMs", () => {
  it("formats a Date into the UTC backup stamp", () => {
    const d = new Date("2026-06-04T08:09:05.000Z");
    expect(backupTimestamp(d)).toBe("20260604-080905-utc");
  });

  it("round-trips through the filename parser", () => {
    const d = new Date("2026-06-04T08:09:05.000Z");
    const filename = `backup-${backupTimestamp(d)}.zip`;
    expect(parseBackupUtcMs(filename)).toBe(d.getTime());
  });

  it("returns null for an unrecognized filename", () => {
    expect(parseBackupUtcMs("notes.txt")).toBeNull();
    expect(parseBackupUtcMs("backup-2026-06-04.zip")).toBeNull();
    expect(parseBackupUtcMs("backup-20260604-080905-utc.tar")).toBeNull();
  });
});

describe("selectBackupsToPrune", () => {
  // Anchor "now" to an exact UTC hour boundary so age math is clean.
  const NOW = Date.UTC(2026, 5, 4, 0, 0, 0); // 2026-06-04T00:00:00Z
  const name = (ms: number) => `backup-${backupTimestamp(new Date(ms))}.zip`;

  it("ignores filenames that are not backups", () => {
    const result = selectBackupsToPrune(["random.txt", "notes.json"], NOW);
    expect(result.keep).toEqual([]);
    expect(result.deleteList).toEqual([]);
  });

  it("keeps only the newest backup within a single UTC hour", () => {
    const a = name(NOW - 10 * 60 * 1000); // 10 min ago
    const b = name(NOW - 30 * 60 * 1000); // 30 min ago (same hour slot)
    const result = selectBackupsToPrune([a, b], NOW);
    expect(result.keep).toContain(a);
    expect(result.deleteList).toContain(b);
  });

  it("keeps one per hour across the last 24 hours", () => {
    const files = [1, 2, 3].map((h) => name(NOW - h * MS_HOUR - 60 * 1000));
    // Each is in a distinct hour slot -> all kept.
    const result = selectBackupsToPrune(files, NOW);
    expect(result.deleteList).toEqual([]);
    expect(result.keep.sort()).toEqual(files.sort());
  });

  it("collapses the 1–7 day window to one per day", () => {
    // Two backups on the same UTC day (2 days ago), 12 hours apart. NOW sits on
    // a UTC day boundary, so both fall in the daySlot for that calendar day.
    const dayAgo2a = name(NOW - 2 * MS_DAY + 12 * MS_HOUR); // age 1.5d, newer
    const dayAgo2b = name(NOW - 2 * MS_DAY); // age 2d, older, same day slot
    const result = selectBackupsToPrune([dayAgo2a, dayAgo2b], NOW);
    expect(result.keep).toContain(dayAgo2a);
    expect(result.deleteList).toContain(dayAgo2b);
  });

  it("collapses the 7–30 day window to one per week", () => {
    // Two backups in the same week (~10 days ago), a day apart.
    const a = name(NOW - 10 * MS_DAY);
    const b = name(NOW - 11 * MS_DAY);
    const result = selectBackupsToPrune([a, b], NOW);
    // Same week slot -> keep the newer (a), drop b.
    expect(result.keep).toContain(a);
    expect(result.deleteList).toContain(b);
  });

  it("deletes anything older than 30 days", () => {
    const old = name(NOW - 31 * MS_DAY);
    const result = selectBackupsToPrune([old], NOW);
    expect(result.keep).toEqual([]);
    expect(result.deleteList).toEqual([old]);
  });

  it("keeps representatives across all three buckets simultaneously", () => {
    const recent = name(NOW - 30 * 60 * 1000); // < 24h
    const daily = name(NOW - 3 * MS_DAY); // 1–7d
    const weekly = name(NOW - 2 * MS_WEEK); // 7–30d
    const ancient = name(NOW - 40 * MS_DAY); // >30d
    const result = selectBackupsToPrune([recent, daily, weekly, ancient], NOW);
    expect(result.keep.sort()).toEqual([recent, daily, weekly].sort());
    expect(result.deleteList).toEqual([ancient]);
  });
});
