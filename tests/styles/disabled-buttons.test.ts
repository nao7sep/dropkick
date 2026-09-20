import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = join(process.cwd(), "src");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

// Off, a button is the resting button faded: the same fill, outline, ink, padding
// and footprint, so it stays recognisably the control that will come back. The
// filled primary instead replaced its accent with the page background — 1.05:1
// against the panel it sits on in the light theme, 1.18:1 in the dark — so the
// button stopped having a shape at all, and drew identically to a hovered
// secondary beside it. This app has no button primitive to hold the rule, so the
// rule is held over the sources themselves.
describe("disabled buttons", () => {
  const sources = tsxFiles(SOURCE).map((path) => [relative(SOURCE, path), readFileSync(path, "utf8")] as const);

  it("fades a disabled button instead of replacing its fill", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toContain("disabled:bg-");
      expect(source, name).not.toContain("disabled:text-");
    }
  });

  it("uses one fade everywhere, so no two disabled buttons recede differently", () => {
    const fades = new Set<string>();
    for (const [, source] of sources)
      for (const [, value] of source.matchAll(/disabled:opacity-(\d+)/g)) fades.add(value);
    expect([...fades]).toEqual(["50"]);
  });
});
