import { inEnglish } from "../helpers/i18n";
import { describe, expect, it } from "vitest";
import {
  describeDiskFailure,
  describeLoadFailure,
  describeNoteDraftsFailure,
} from "../../src/services/load-failure";

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

  it("names the note drafts file and says it was left unchanged, whatever went wrong", () => {
    const path = "/Users/person/.dropkick/note-drafts.json";
    for (const result of [
      { status: "invalid", message: "HOSTILE-SENTINEL" },
      { status: "newer", formatVersion: 2 },
      { status: "error", message: "HOSTILE-SENTINEL EACCES" },
    ] as const) {
      const text = inEnglish(describeNoteDraftsFailure(result, path));
      expect(text).toContain(path);
      expect(text).toContain("left unchanged");
      expect(text).not.toContain("HOSTILE-SENTINEL");
    }
  });

  it("names both files when a task list is already open from another one", () => {
    const duplicate = { status: "duplicate", path: "/Users/person/copy.json", otherPath: "/Users/person/list.json" } as const;
    for (const text of [
      inEnglish(describeLoadFailure("taskList", duplicate)),
      inEnglish(describeLoadFailure("taskList", duplicate, duplicate.path)),
      inEnglish(describeDiskFailure(duplicate)),
    ]) {
      expect(text).toContain(duplicate.path);
      expect(text).toContain(duplicate.otherPath);
    }
  });
});

