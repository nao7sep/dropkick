// The Records window's own capability and build page: configuration the
// window depends on, read from the files that define it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
}

describe("the Records window", () => {
  it("has a capability of its own that grants only its events and its title", () => {
    const capability = JSON.parse(source("src-tauri/capabilities/records.json")) as {
      windows: string[];
      permissions: string[];
    };
    expect(capability.windows).toEqual(["records"]);
    expect(capability.permissions.sort()).toEqual([
      "core:event:allow-emit-to",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-set-title",
    ]);
  });

  it("is a page of its own in the build", () => {
    expect(source("vite.config.ts")).toMatch(/records: "records\.html"/);
    expect(source("records.html")).toContain('src="/src/records-main.tsx"');
  });
});
