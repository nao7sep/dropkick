import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What the packages contain, read from the bundle configuration. The packaging
// scripts are tested by running them.
describe("installer configuration", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"),
  );

  it("allows current-user and all-users installation", () => {
    expect(config.bundle?.windows?.nsis?.installMode).toBe("both");
  });

  it("ships the application licence", () => {
    expect(config.bundle?.resources?.["../LICENSE"]).toBe("LICENSE.txt");
  });
});
