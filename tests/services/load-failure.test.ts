import { describe, expect, it } from "vitest";
import { describeLoadFailure } from "../../src/services/load-failure";

describe("load failure presentation", () => {
  it("keeps diagnostic exception text out of user-facing copy", () => {
    const message = describeLoadFailure(
      "workspace",
      {
        status: "error",
        message: "TypeError EACCES /private/tmp/HOSTILE-SENTINEL Error invoking remote method",
      },
      "/Users/person/Documents/workspace.json",
    );

    expect(message).toContain("workspace file could not be read");
    expect(message).toContain("/Users/person/Documents/workspace.json");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("EACCES");
  });
});
