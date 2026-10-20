import { describe, it, expect } from "vitest";
import type { Root } from "postcss";
import { appCss, declarationValue, parseCss, rulesOf, selectorOf } from "../helpers/css-tree";
import { jsxElements, parseSource, tsxSources, utilityOf, type Source } from "../helpers/tsx-classes";

// Text cut short draws exactly one marker and keeps a keyboard and touch path to
// its whole value (text-cleanup-conventions rule 4). Truncation is a reviewed
// exception, so a new site fails here until it is justified and listed, and a
// clip with no marker fails outright. Both lists are compared whole, so an
// entry whose site is gone fails as well.

// Each reviewed site, with the path to its whole value.
const CSS_ELLIPSIS = [
  "select.dk-field", // opening the select shows every option whole
  ".dk-menu-text", // menu text: names differ early; Workspaces and an opened list show it whole
];
const CLASS_TRUNCATION: Record<string, number> = {
  "src/components/layout/TabBar.tsx": 1, // tab name: activating the tab titles the window with it
  // Workspace name and path: the shortened values tell workspaces apart, and
  // Rename shows the name whole.
  "src/components/layout/StartupPicker.tsx": 2,
  // Task row: selecting it shows the title in the detail pane. Unified-view
  // list label: that list's tab titles the window with the whole name.
  "src/components/task-list/TaskListPane.tsx": 2,
  "src/components/records/RecordsWindow.tsx": 1, // record row: selecting it shows the message in the detail pane
};

const ELLIPSIS_CLASSES = ["truncate", ...CSS_ELLIPSIS.filter((s) => s.startsWith(".")).map((s) => s.slice(1))];

const hasEllipsis = (css: Root) =>
  rulesOf(css).filter((rule) => declarationValue(rule, "text-overflow") === "ellipsis");

// Stylesheet selectors that draw the "…".
function cssEllipsis(css: Root): string[] {
  return hasEllipsis(css).map(selectorOf);
}

// Stylesheet rules that keep text on one line and cut it with no marker.
function cssClipsWithoutMarker(css: Root): string[] {
  return rulesOf(css)
    .filter(
      (rule) =>
        declarationValue(rule, "white-space") === "nowrap" &&
        ["overflow", "overflow-x"].some((property) => /^(hidden|clip)\b/.test(declarationValue(rule, property) ?? "")) &&
        declarationValue(rule, "text-overflow") !== "ellipsis",
    )
    .map(selectorOf);
}

// Stylesheet rules that put the marker on a flex or grid box.
function cssEllipsisOnLayoutBoxes(css: Root): string[] {
  return hasEllipsis(css)
    .filter((rule) => /^(inline-)?(flex|grid)$/.test(declarationValue(rule, "display") ?? ""))
    .map(selectorOf);
}

// Elements whose own classes truncate, counted per file.
function truncationSites(sources: readonly Source[]): Record<string, number> {
  return Object.fromEntries(
    sources
      .map(({ file, ast }) => [
        file,
        jsxElements(ast).filter(({ classes }) =>
          classes.map(utilityOf).some((utility) => utility === "truncate" || /^line-clamp-\d+$/.test(utility)),
        ).length,
      ] as const)
      .filter(([, count]) => count > 0),
  );
}

function elementsWhere(sources: readonly Source[], test: (utilities: string[]) => boolean): string[] {
  return sources.flatMap(({ file, ast }) =>
    jsxElements(ast)
      .filter(({ classes }) => test(classes.map(utilityOf)))
      .map(({ line, classes }) => `${file}:${line}: ${classes.join(" ")}`),
  );
}

// Elements that keep text on one line and cut it with no marker.
function componentClipsWithoutMarker(sources: readonly Source[]): string[] {
  return elementsWhere(
    sources,
    (utilities) =>
      utilities.includes("whitespace-nowrap") &&
      utilities.some((utility) => /^overflow(-x)?-(hidden|clip)$/.test(utility)),
  );
}

// Elements that put the marker on a flex or grid box.
function componentEllipsisOnLayoutBoxes(sources: readonly Source[]): string[] {
  return elementsWhere(
    sources,
    (utilities) =>
      utilities.some((utility) => ELLIPSIS_CLASSES.includes(utility)) &&
      utilities.some((utility) => /^(inline-)?(flex|grid)$/.test(utility)),
  );
}

const css = appCss();
const components = tsxSources("src/components");

describe("truncation", () => {
  it("draws the stylesheet's ellipsis only on reviewed selectors", () => {
    expect(cssEllipsis(css)).toEqual(CSS_ELLIPSIS);
  });

  it("never clips one-line stylesheet text without a marker", () => {
    expect(cssClipsWithoutMarker(css)).toEqual([]);
  });

  it("truncates component text only at reviewed sites", () => {
    expect(truncationSites(components)).toEqual(CLASS_TRUNCATION);
  });

  it("never clips one-line component text without a marker", () => {
    expect(componentClipsWithoutMarker(components)).toEqual([]);
  });

  // A flex or grid container clips its text but draws no "…": the text runs
  // become anonymous items that text-overflow does not reach. The marker
  // belongs on a block or inline-block box holding the text.
  it("never declares an ellipsis on a flex or grid box", () => {
    expect([...cssEllipsisOnLayoutBoxes(css), ...componentEllipsisOnLayoutBoxes(components)]).toEqual([]);
  });

  it("finds planted stylesheet sites: an unreviewed ellipsis, a bare clip and a flex box", () => {
    const planted = parseCss(`
      @layer components {
        .chip { white-space: nowrap; overflow: hidden; }
        .tag { display: flex; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      }
    `);
    expect(cssEllipsis(planted)).toEqual([".tag"]);
    expect(cssClipsWithoutMarker(planted)).toEqual([".chip"]);
    expect(cssEllipsisOnLayoutBoxes(planted)).toEqual([".tag"]);
  });

  it("finds planted component sites: a truncation, a bare clip and a flex box", () => {
    const planted: Source = {
      file: "planted.tsx",
      ast: parseSource(
        [
          "const CLIP = 'whitespace-nowrap overflow-hidden';",
          "const A = () => <span className={CLIP}>a</span>;",
          'const B = () => <span className={`min-w-0 ${wide ? "flex" : "block"} truncate`}>b</span>;',
        ].join("\n"),
        "planted.tsx",
      ),
    };
    expect(truncationSites([planted])).toEqual({ "planted.tsx": 1 });
    expect(componentClipsWithoutMarker([planted])).toEqual(["planted.tsx:2: whitespace-nowrap overflow-hidden"]);
    expect(componentEllipsisOnLayoutBoxes([planted])).toEqual(["planted.tsx:3: min-w-0 truncate flex block"]);
  });
});
