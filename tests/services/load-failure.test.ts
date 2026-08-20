import { describe, it, expect } from "vitest";
import {
  describeLoadFailure,
  fileNameWithoutExt,
} from "../../src/services/load-failure";

describe("describeLoadFailure", () => {
  it("names the document kind, so one wording change reaches every surface", () => {
    // Five module-private copies said this five ways; each handled `missing`
    // and let everything else fall through, so adding a status to a result
    // union compiled clean while some surfaces said the wrong thing.
    expect(describeLoadFailure("preferences", { status: "missing" }, "/p.json")).toBe(
      "The preferences file could not be found:\n\n/p.json",
    );
    expect(describeLoadFailure("workspace", { status: "missing" }, "/w.json")).toBe(
      "The workspace file could not be found:\n\n/w.json",
    );
  });

  it("carries the underlying reason for a load that failed rather than a file that is absent", () => {
    expect(
      describeLoadFailure("task list", { status: "invalid", message: "bad json" }, "/t.json"),
    ).toBe("The task list file could not be loaded:\n\n/t.json\n\nbad json");
    expect(
      describeLoadFailure("task list", { status: "error", message: "boom" }, "/t.json"),
    ).toBe("The task list file could not be loaded:\n\n/t.json\n\nboom");
  });

  it("omits the path where the surface already shows it", () => {
    // The inline banner inside a tab is for that very file.
    expect(describeLoadFailure("task list", { status: "missing" })).toBe(
      "The task list file could not be found.",
    );
    expect(
      describeLoadFailure("task list", { status: "error", message: "boom" }),
    ).toBe("The task list file could not be loaded:\n\nboom");
  });
});

describe("fileNameWithoutExt", () => {
  it("takes the base name and drops the .json extension", () => {
    expect(fileNameWithoutExt("/a/b/tasks.json")).toBe("tasks");
    expect(fileNameWithoutExt("C:\\a\\b\\tasks.json")).toBe("tasks");
  });

  it("leaves a name that has no .json extension alone", () => {
    expect(fileNameWithoutExt("/a/b/notes.txt")).toBe("notes.txt");
    expect(fileNameWithoutExt("/a/b/plain")).toBe("plain");
  });

  it("returns an empty label for an empty path rather than a made-up one", () => {
    // The two copies carried different fallbacks ("tasks" and "default"), both
    // unreachable: split always yields at least one element.
    expect(fileNameWithoutExt("")).toBe("");
  });
});
