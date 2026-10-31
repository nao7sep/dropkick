import { inEnglish } from "../helpers/i18n";
import { describe, expect, it } from "vitest";
import { describeLaunchStop, describeSideStoreOff } from "../../src/services/recovery-presentation";

describe("recovery presentation", () => {
  it("names every refused file in the launch stop, newer or unreadable, and what to do", () => {
    const paragraphs = describeLaunchStop([
      { path: "/root/settings.json", reason: "newer" },
      { path: "/root/config.json", reason: "unreadable" },
    ]).map(inEnglish);
    expect(paragraphs[0]).toContain("Nothing was changed");
    expect(paragraphs[1]).toBe("/root/settings.json\nThis file was saved by a newer version of Dropkick.");
    expect(paragraphs[2]).toBe("/root/config.json\nThis file could not be read.");
    expect(paragraphs[3]).toContain("move them away to start fresh");
    expect(paragraphs).toHaveLength(4);
  });

  it("says which side store is off, names its file and that it was left unchanged", () => {
    const records = describeSideStoreOff("records", "/root/records.sqlite3");
    expect(inEnglish(records.title)).toBe("Records Are Off");
    expect(inEnglish(records.body)).toContain("/root/records.sqlite3");
    expect(inEnglish(records.body)).toContain("left unchanged");
    const backups = describeSideStoreOff("backups", "/root/backups.sqlite3");
    expect(inEnglish(backups.title)).toBe("Backup History Is Off");
    expect(inEnglish(backups.body)).toContain("/root/backups.sqlite3");
  });
});
