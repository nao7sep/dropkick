import { describe, it, expect } from "vitest";
import { isExcludedHomeFile } from "../../../src/services/backup/homeRootExclusions";

describe("isExcludedHomeFile", () => {
  it("keeps durable home-root data", () => {
    expect(isExcludedHomeFile("config.json")).toBe(false);
    expect(isExcludedHomeFile("workspace.json")).toBe(false);
  });

  it("excludes the feature's own output, logs, temporaries, and volatile state", () => {
    expect(isExcludedHomeFile("logs/20260701-000000-000-utc.log")).toBe(true);
    expect(isExcludedHomeFile("backups/index.json")).toBe(true);
    expect(isExcludedHomeFile("config-V1StGXR8.tmp")).toBe(true);
    expect(isExcludedHomeFile("state.json")).toBe(true);
  });

  it("excludes the OS-noise floor anywhere, matched case-insensitively", () => {
    expect(isExcludedHomeFile(".DS_Store")).toBe(true);
    expect(isExcludedHomeFile("sub/.DS_Store")).toBe(true);
    expect(isExcludedHomeFile("Thumbs.db")).toBe(true);
    expect(isExcludedHomeFile("desktop.ini")).toBe(true);
    expect(isExcludedHomeFile("Desktop.ini")).toBe(true);
  });
});
