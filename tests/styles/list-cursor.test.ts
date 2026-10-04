// @vitest-environment node
//
// A list's keyboard cursor, the ring on its active row, follows keyboard use:
// it is drawn while the list is `:focus-visible`, so a click selects a row
// without ringing it and the next key brings the ring back
// (composite-control-conventions, Visual State). Every row cursor this app
// draws from its list's focus is found here by its text, so a list that keys it
// on focus itself, as the task list once did, fails.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

// A ring drawn on a row from its group's focus state, in any of its spellings.
const ROW_CURSOR = /\bgroup-focus(?:-[\w-]+)?:ring(?:-\[[^\]]*\]|-[\w-]+)?/g;
const KEYBOARD_USE = /^group-focus-visible:/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|html)$/.test(name) ? [path] : [];
  });
}

function offending(text: string): string[] {
  return [...text.matchAll(ROW_CURSOR)].map((m) => m[0]).filter((c) => !KEYBOARD_USE.test(c));
}

const cursors = sourceFiles(join(ROOT, "src")).flatMap((path) => {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(ROW_CURSOR)].map((m) => ({ file: relative(ROOT, path), cls: m[0] }));
});

describe("a list's keyboard cursor follows keyboard use", () => {
  it("finds the row cursors of both lists", () => {
    const files = new Set(cursors.map((c) => c.file));
    expect(files).toContain(join("src", "components", "task-list", "TaskListPane.tsx"));
    expect(files).toContain(join("src", "components", "records", "RecordsWindow.tsx"));
  });

  it("keys every row cursor on the list's :focus-visible", () => {
    const wrong = cursors.filter((c) => !KEYBOARD_USE.test(c.cls)).map((c) => `${c.file}: ${c.cls}`);
    expect(wrong).toEqual([]);
  });

  it("flags a cursor keyed on focus itself", () => {
    expect(offending('"group-focus-within:ring-[1.5px] group-focus:ring-primary-ring"')).toEqual([
      "group-focus-within:ring-[1.5px]",
      "group-focus:ring-primary-ring",
    ]);
  });
});
