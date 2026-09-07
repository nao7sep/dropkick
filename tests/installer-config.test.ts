import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("installer configuration", () => {
  const config = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8"),
  );

  it("allows current-user and all-users installation", () => {
    expect(config.bundle?.windows?.nsis?.installMode).toBe("both");
  });

  it("ships the application licence in installed and portable packages", () => {
    expect(config.bundle?.resources?.["../LICENSE"]).toBe("LICENSE.txt");
    const packageScript = readFileSync(
      join(process.cwd(), "scripts", "package.ps1"),
      "utf8",
    );
    expect(packageScript).toContain(
      'Compress-Archive -Path "src-tauri/target/release/dropkick.exe", "LICENSE"',
    );
  });
});
