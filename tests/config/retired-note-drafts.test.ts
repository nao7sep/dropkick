import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Note drafts last only while Dropkick runs (developer decision). A drafts file
// written by an earlier build is left exactly as it is: nothing reads, writes,
// moves or deletes it. Any code that touched it would have to name it, so no
// shipped source may.
const roots = ["../../src", "../../src-tauri/src"].map((root) =>
  fileURLToPath(new URL(root, import.meta.url)),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "locales" ? [] : sourceFiles(path);
    return /\.(ts|tsx|rs|json)$/.test(entry.name) ? [path] : [];
  });
}

describe("an old note drafts file", () => {
  it("is named by no shipped source", () => {
    const naming = roots
      .flatMap(sourceFiles)
      .filter((path) => /note-drafts\.json|noteDraftsFile|note_drafts_file/.test(readFileSync(path, "utf8")));
    expect(naming).toEqual([]);
  });
});
