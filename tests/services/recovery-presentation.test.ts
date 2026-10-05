import { inEnglish } from "../helpers/i18n";
import { describe, expect, it } from "vitest";
import {
  describeAppConfigRecovery,
  describeNoteDraftRecovery,
} from "../../src/services/recovery-presentation";

describe("recovery presentation", () => {
  it("keeps internal quarantine paths out of both recovery notices", () => {
    const hostile = { kind: "quarantined", quarantinedTo: "/.dropkick/HOSTILE-SENTINEL-EACCES.invalid" } as const;
    for (const notice of [describeAppConfigRecovery(hostile), describeNoteDraftRecovery(hostile)]) {
      const message = inEnglish(notice.body);
      expect(message).toContain("location is recorded in the application log");
      expect(message).not.toContain("/.dropkick/");
      expect(message).not.toContain(".invalid");
      expect(message).not.toContain("HOSTILE-SENTINEL");
      expect(message).not.toContain("EACCES");
    }
  });

  it("says a newer build's file was left unchanged rather than reset", () => {
    const newer = { kind: "newer", formatVersion: 2 } as const;
    for (const notice of [describeAppConfigRecovery(newer), describeNoteDraftRecovery(newer)]) {
      expect(inEnglish(notice.title)).toContain("Not Loaded");
      expect(inEnglish(notice.body)).toContain("newer version of Dropkick");
      expect(inEnglish(notice.body)).toContain("left unchanged");
    }
  });
});
