import { describe, expect, it } from "vitest";
import {
  describeAppStateRecovery,
  describeNoteDraftRecovery,
} from "../../src/services/recovery-presentation";

describe("recovery presentation", () => {
  it("keeps internal quarantine paths out of both recovery notices", () => {
    for (const message of [describeAppStateRecovery(), describeNoteDraftRecovery()]) {
      expect(message).toContain("location is recorded in the application log");
      expect(message).not.toContain("/.dropkick/");
      expect(message).not.toContain(".invalid");
      expect(message).not.toContain("HOSTILE-SENTINEL");
    }
  });
});
