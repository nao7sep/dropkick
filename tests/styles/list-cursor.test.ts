// @vitest-environment node
//
// A list's keyboard cursor, the ring on its active row, follows keyboard use:
// it is drawn while the list is `:focus-visible`, so a click selects a row
// without ringing it and the next key brings the ring back
// (composite-control-conventions, Visual State). Every row cursor this app
// draws from its list's focus is found here from the syntax trees, so a list
// that keys it on focus itself, as the task list once did, fails.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Root } from "postcss";
import { describe, expect, it } from "vitest";
import { parseCss, readCss } from "../helpers/css-tree";
import { filesUnder, parseSource, readSource, ROOT, stringTokens, type Ast } from "../helpers/tsx-classes";

// A ring drawn on a row from its group's focus state, in any of its spellings.
const ROW_CURSOR = /\bgroup-focus(?:-[\w-]+)?:ring(?:-\[[^\]]*\]|-[\w-]+)?/g;
const KEYBOARD_USE = /^group-focus-visible:/;

type Cursor = { file: string; cls: string };

// Classes in the program's strings, which is where a component's classes live.
function programCursors(file: string, program: Ast): Cursor[] {
  return stringTokens(program).flatMap(({ token }) =>
    [...token.matchAll(ROW_CURSOR)].map((m) => ({ file, cls: m[0] })),
  );
}

// Utilities a stylesheet applies, which reach CSS only through `@apply`.
function stylesheetCursors(file: string, css: Root): Cursor[] {
  const found: Cursor[] = [];
  css.walkAtRules("apply", (rule) => {
    for (const m of rule.params.matchAll(ROW_CURSOR)) found.push({ file, cls: m[0] });
  });
  return found;
}

// Markup has no parser in this toolchain, so a page's `class` attributes are
// read from its text.
function markupCursors(file: string, html: string): Cursor[] {
  return [...html.matchAll(/\bclass\s*=\s*"([^"]*)"/g)].flatMap(([, value]) =>
    [...value!.matchAll(ROW_CURSOR)].map((m) => ({ file, cls: m[0] })),
  );
}

const cursors = [
  ...filesUnder("src", (name) => /\.tsx?$/.test(name)).flatMap((file) => programCursors(file, readSource(file).ast)),
  ...filesUnder("src", (name) => name.endsWith(".css")).flatMap((file) => stylesheetCursors(file, readCss(file))),
  ...filesUnder("src", (name) => name.endsWith(".html")).flatMap((file) =>
    markupCursors(file, readFileSync(join(ROOT, file), "utf8")),
  ),
];

function offending(found: readonly Cursor[]): string[] {
  return found.filter((c) => !KEYBOARD_USE.test(c.cls)).map((c) => c.cls);
}

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
    const planted = 'const Row = () => <div className={`px-2 ${on ? "group-focus-within:ring-[1.5px] group-focus:ring-primary-ring" : ""}`} />;';
    expect(offending(programCursors("planted.tsx", parseSource(planted, "planted.tsx")))).toEqual([
      "group-focus-within:ring-[1.5px]",
      "group-focus:ring-primary-ring",
    ]);
    expect(offending(stylesheetCursors("planted.css", parseCss(".row { @apply group-focus:ring-2; }")))).toEqual([
      "group-focus:ring-2",
    ]);
  });
});
