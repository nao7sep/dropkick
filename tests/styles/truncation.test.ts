import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Text cut short draws exactly one marker and keeps a keyboard and touch path to
// its whole value (text-cleanup-conventions rule 4). Truncation is a reviewed
// exception, so a new site fails here until it is justified and listed, and a
// clip with no marker fails outright.
const src = fileURLToPath(new URL("../../src", import.meta.url));
const css = readFileSync(join(src, "App.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Each reviewed site, with the path to its whole value.
const CSS_ELLIPSIS = [
  "select.dk-field", // opening the select shows every option whole
];
const CLASS_TRUNCATION: Record<string, number> = {
  "components/layout/TabBar.tsx": 1, // tab name: activating the tab titles the window with it
  // Task row: selecting it shows the title in the detail pane. Unified-view
  // list label: that list's tab titles the window with the whole name.
  "components/task-list/TaskListPane.tsx": 2,
  "components/records/RecordsWindow.tsx": 1, // record row: selecting it shows the message in the detail pane
};

// Innermost rule blocks, which is where Tailwind's @layer nesting keeps them.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim(),
  body: match[2],
}));

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}
const components = componentFiles(join(src, "components")).map((path) => ({
  name: path.slice(src.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("truncation", () => {
  it("draws the stylesheet's ellipsis only on reviewed selectors", () => {
    const drawn = rules.filter((rule) => /text-overflow\s*:\s*ellipsis/.test(rule.body)).map((rule) => rule.selector);
    expect(drawn).toEqual(CSS_ELLIPSIS);
  });

  it("never clips one-line stylesheet text without a marker", () => {
    const clipped = rules.filter(
      (rule) =>
        /white-space\s*:\s*nowrap/.test(rule.body) &&
        /overflow(-x)?\s*:\s*(hidden|clip)/.test(rule.body) &&
        !/text-overflow\s*:\s*ellipsis/.test(rule.body),
    );
    expect(clipped.map((rule) => rule.selector)).toEqual([]);
  });

  it("truncates component text only at reviewed sites", () => {
    const sites = Object.fromEntries(
      components
        .map(({ name, text }) => [name, (text.match(/\b(truncate|line-clamp-\d)\b/g) ?? []).length] as const)
        .filter(([, count]) => count > 0),
    );
    expect(sites).toEqual(CLASS_TRUNCATION);
  });

  it("never clips one-line component text without a marker", () => {
    const clipped = components.flatMap(({ name, text }) =>
      [...text.matchAll(/className=(["`])([^"`]*)\1/g)]
        .map((match) => match[2])
        .filter((value) => /\bwhitespace-nowrap\b/.test(value) && /\boverflow(-x)?-(hidden|clip)\b/.test(value))
        .map((value) => `${name}: ${value}`),
    );
    expect(clipped).toEqual([]);
  });
});
