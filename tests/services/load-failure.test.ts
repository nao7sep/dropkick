import { inEnglish } from "../helpers/i18n";
import { describe, expect, it } from "vitest";
import { describeDiskFailure, describeLoadFailure } from "../../src/services/load-failure";

describe("load failure presentation", () => {
  it("keeps diagnostic exception text out of user-facing copy", () => {
    const message = inEnglish(describeLoadFailure(
      "workspace",
      {
        status: "error",
        message: "TypeError EACCES /private/tmp/HOSTILE-SENTINEL Error invoking remote method",
      },
      "/Users/person/Documents/workspace.json",
    ));

    expect(message).toContain("workspace file could not be read");
    expect(message).toContain("/Users/person/Documents/workspace.json");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("EACCES");
  });

  it("says a newer build's document was left unchanged, on every surface", () => {
    const newer = { status: "newer", formatVersion: 2 } as const;
    for (const kind of ["taskList", "preferences", "workspace"] as const) {
      expect(inEnglish(describeLoadFailure(kind, newer))).toContain("newer version of Dropkick");
      const at = inEnglish(describeLoadFailure(kind, newer, "/Users/person/list.json"));
      expect(at).toContain("/Users/person/list.json");
      expect(at).toContain("left unchanged");
    }
    expect(inEnglish(describeDiskFailure(newer))).toContain("the copy Dropkick loaded earlier");
  });
});
