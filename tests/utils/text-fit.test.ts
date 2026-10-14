// Display-only shortening of variable text (interface-styling-conventions,
// Labels): names keep their beginning, paths their final segment, and a
// message about several items names a few and counts the rest.
import { describe, expect, it } from "vitest";
import { createTranslator } from "../../src/i18n/translate";
import { nameFew, shortenName, shortenPath } from "../../src/utils";

describe("shortenName", () => {
  it("keeps a name that fits", () => {
    expect(shortenName("Work", 32)).toBe("Work");
  });

  it("keeps the beginning and ends in one ellipsis", () => {
    expect(shortenName("Quarterly planning for the platform team", 16)).toBe("Quarterly plann…");
  });

  it("never splits a character outside the basic plane", () => {
    expect(shortenName("😀😀😀😀😀", 3)).toBe("😀😀…");
  });
});

describe("shortenPath", () => {
  it("keeps a path that fits", () => {
    expect(shortenPath("/Users/me/tasks/work.json", 48)).toBe("/Users/me/tasks/work.json");
  });

  it("keeps the root and the final segments and loses the middle", () => {
    const shortened = shortenPath("/Users/me/code/clients/acme/projects/2026/tasks/work.json", 36);
    expect(shortened.startsWith("/Users/…/")).toBe(true);
    expect(shortened.endsWith("/tasks/work.json")).toBe(true);
    expect(Array.from(shortened).length).toBeLessThanOrEqual(36);
  });

  it("keeps a Windows drive and backslashes", () => {
    const shortened = shortenPath("C:\\Users\\me\\Documents\\clients\\acme\\tasks\\work.json", 28);
    expect(shortened.startsWith("C:\\…\\")).toBe(true);
    expect(shortened.endsWith("\\work.json")).toBe(true);
  });

  it("keeps the file even when it alone is too long", () => {
    const shortened = shortenPath("/a/b/an-extremely-long-task-list-file-name-for-testing.json", 24);
    expect(shortened.startsWith("…/an-extremely")).toBe(true);
    expect(Array.from(shortened).length).toBeLessThanOrEqual(24);
  });
});

describe("nameFew", () => {
  const en = createTranslator("en");
  const format = {
    list: (items: readonly string[]) => en.list(items),
    more: (count: number) => en.t("common.andMore", { count }),
  };

  it("names every value when there are only a few", () => {
    expect(nameFew(["Work", "Home"], format)).toBe("Work, Home");
  });

  it("names three and counts the rest", () => {
    expect(nameFew(["A", "B", "C", "D", "E"], format)).toBe("A, B, C, and 2 more");
  });

  it("shortens each named value", () => {
    expect(nameFew(["A list whose name goes on and on without end", "B"], format))
      .toBe("A list whose name goes on and o…, B");
  });
});

describe("describeTaskActionFailures", () => {
  it("lists the first few failed tasks and counts the rest", async () => {
    const { describeTaskActionFailures } = await import("../../src/services/task-action-results");
    const en = createTranslator("en");
    const failures = ["One", "Two", "Three", "Four", "Five"].map((title) => ({
      task: { title } as never,
      reason: { key: "common.untitled" } as never,
    }));
    expect(en.text(describeTaskActionFailures(failures)).split("\n")).toEqual([
      "One: Untitled", "Two: Untitled", "Three: Untitled", "and 2 more",
    ]);
  });
});
