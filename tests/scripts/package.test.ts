// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../../scripts/package.sh", import.meta.url);
const windowsScript = readFileSync(new URL("../../scripts/package.ps1", import.meta.url), "utf8");
const appName = "Dropkick";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function packageFixture(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "package-fixture-"));
  roots.push(root);
  for (const dir of ["scripts", "src-tauri", "node_modules/.bin", "tools",
    "src-tauri/target/release/bundle/dmg", "src-tauri/target/release/bundle/macos/Old.app"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(script, join(root, "scripts/package.sh"));
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "2.0.0" }));
  writeFileSync(join(root, "src-tauri/target/release/bundle/dmg/Old-1.0.0.dmg"), "stale installer");
  writeFileSync(join(root, "node_modules/.bin/tauri"), `#!/bin/bash
set -eu
if [[ "$FIXTURE_MODE" == fail ]]; then exit 1; fi
if [[ "$FIXTURE_MODE" == none ]]; then exit 0; fi
mkdir -p src-tauri/target/release/bundle/{dmg,macos/Current.app}
printf current > src-tauri/target/release/bundle/dmg/Current-2.0.0.dmg
if [[ "$FIXTURE_MODE" == double ]]; then
  printf other > src-tauri/target/release/bundle/dmg/Other-2.0.0.dmg
fi
`, { mode: 0o755 });
  writeFileSync(join(root, "tools/ditto"), `#!/bin/bash
for destination in "$@"; do :; done
printf current-app > "$destination"
`, { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "scripts/package.sh")], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, FIXTURE_MODE: mode, PATH: `${join(root, "tools")}:${process.env.PATH}` },
  });
  if (result.error) throw result.error;
  return { root, result };
}

describe("current-build package collection", () => {
  it.skipIf(process.platform === "win32")("discards stale bundles and collects only the new installer and app", () => {
    const { root, result } = packageFixture("success");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, `artifacts/${appName}-2.0.0.dmg`), "utf8")).toBe("current");
    expect(readFileSync(join(root, `artifacts/${appName}-2.0.0-mac.zip`), "utf8")).toBe("current-app");
  });
  it.skipIf(process.platform === "win32").each(["none", "double", "fail"])("refuses %s build outputs despite a stale installer", mode => {
    const { root, result } = packageFixture(mode);
    expect(result.status).not.toBe(0);
    expect(() => readFileSync(join(root, `artifacts/${appName}-2.0.0.dmg`))).toThrow();
  });
  it("Windows source cleans generated outputs before building and requires one fresh setup", () => {
    const cleanup = windowsScript.indexOf('foreach ($output in @("artifacts", $NsisDirectory, $PortableExecutable))');
    const build = windowsScript.indexOf('& $TauriCli build --bundles nsis');
    const check = windowsScript.indexOf('$setups.Count -ne 1');
    const copy = windowsScript.indexOf('Copy-Item $setups[0].FullName');
    expect(cleanup).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(cleanup);
    expect(check).toBeGreaterThan(build);
    expect(copy).toBeGreaterThan(check);
    expect(windowsScript).not.toContain("Select-Object -First 1");
  });
});

type WindowsBuildMode = "success" | "fail" | "none" | "double" | "missing-portable";

function windowsPackageFixture(mode: WindowsBuildMode) {
  const root = mkdtempSync(join(tmpdir(), "package-windows-fixture-"));
  roots.push(root);
  for (const dir of ["scripts", "node_modules/.bin", "artifacts", "src-tauri/target/release/bundle/nsis"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, "scripts/package.ps1"), windowsScript);
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "2.0.0" }));
  writeFileSync(join(root, "LICENSE"), "fixture licence");
  writeFileSync(join(root, "THIRD_PARTY_NOTICES"), "fixture notices");
  writeFileSync(join(root, "artifacts/stale.zip"), "stale archive");
  writeFileSync(join(root, "src-tauri/target/release/bundle/nsis/Old-1.0.0-setup.exe"), "stale installer");
  writeFileSync(join(root, "src-tauri/target/release/dropkick.exe"), "stale executable");
  // Substitute only the expensive build. The real PowerShell script owns
  // cleanup, failure handling, installer selection and portable packaging.
  writeFileSync(join(root, "node_modules/.bin/tauri.cmd"),
    `@"${process.execPath}" "%~dp0fixture-build.mjs" %*\r\n`);
  writeFileSync(join(root, "node_modules/.bin/fixture-build.mjs"), `
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2), ["build", "--bundles", "nsis"]);
assert.equal(existsSync("src-tauri/target/release/bundle/nsis"), false);
assert.equal(existsSync("src-tauri/target/release/dropkick.exe"), false);
assert.deepEqual(readdirSync("artifacts"), []);
writeFileSync("build-entered", "clean");
const mode = process.env.FIXTURE_MODE;
if (mode === "fail") process.exit(17);
if (mode === "none") process.exit(0);
mkdirSync("src-tauri/target/release/bundle/nsis", { recursive: true });
writeFileSync("src-tauri/target/release/bundle/nsis/Current-2.0.0-setup.exe", "current installer");
if (mode === "double") writeFileSync("src-tauri/target/release/bundle/nsis/Other-2.0.0-setup.exe", "other installer");
if (mode !== "missing-portable") writeFileSync("src-tauri/target/release/dropkick.exe", "current executable");
`);
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/package.ps1"),
  ], { encoding: "utf8", timeout: 5000, env: { ...process.env, FIXTURE_MODE: mode } });
  if (result.error) throw result.error;
  return { root, result };
}

describe.skipIf(process.platform !== "win32")("Windows current-build package collection", () => {
  it("removes stale outputs and packages the fresh installer, executable and notices", () => {
    const { root, result } = windowsPackageFixture("success");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, "build-entered"), "utf8")).toBe("clean");
    expect(readdirSync(join(root, "artifacts")).sort()).toEqual([
      `${appName}-2.0.0-setup.exe`, `${appName}-2.0.0-win.zip`,
    ]);
    expect(readFileSync(join(root, `artifacts/${appName}-2.0.0-setup.exe`), "utf8")).toBe("current installer");
    const unpacked = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:FIXTURE_ARCHIVE -DestinationPath $env:FIXTURE_EXPANDED",
    ], {
      encoding: "utf8", timeout: 5000,
      env: {
        ...process.env,
        FIXTURE_ARCHIVE: join(root, `artifacts/${appName}-2.0.0-win.zip`),
        FIXTURE_EXPANDED: join(root, "expanded"),
      },
    });
    if (unpacked.error) throw unpacked.error;
    expect(unpacked.status, unpacked.stderr).toBe(0);
    expect(readdirSync(join(root, "expanded")).sort()).toEqual(["LICENSE", "THIRD_PARTY_NOTICES", "dropkick.exe"]);
    expect(readFileSync(join(root, "expanded/dropkick.exe"), "utf8")).toBe("current executable");
    expect(readFileSync(join(root, "expanded/LICENSE"), "utf8")).toBe("fixture licence");
    expect(readFileSync(join(root, "expanded/THIRD_PARTY_NOTICES"), "utf8")).toBe("fixture notices");
  });

  it.each([
    ["fail", "Tauri build failed with exit code 17"],
    ["none", "Expected exactly one NSIS setup.exe from this build"],
    ["double", "Expected exactly one NSIS setup.exe from this build"],
    ["missing-portable", "This build did not produce the portable executable"],
  ] as const)("refuses %s without publishing stale or incomplete artifacts", (mode, error) => {
    const { root, result } = windowsPackageFixture(mode);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
    expect(readFileSync(join(root, "build-entered"), "utf8")).toBe("clean");
    expect(readdirSync(join(root, "artifacts"))).toEqual([]);
    expect(existsSync(join(root, "src-tauri/target/release/bundle/nsis/Old-1.0.0-setup.exe"))).toBe(false);
  });
});
