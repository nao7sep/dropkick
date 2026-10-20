import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

// The launcher helper is plain ESM because both shell families execute it directly.
// @ts-expect-error The directly executed .mjs helper intentionally has no declaration file.
import { claimRuntime, isRuntimeOwner, ownsProcess, releaseRuntime, REPO_ROOT } from "../../scripts/launcher-runtime.mjs";

describe("launcher process identity", () => {

  it("owns only this repository's Dropkick runtime", () => {
    expect(ownsProcess({
      pid: 10,
      parentPid: 1,
      executablePath: `${REPO_ROOT}/src-tauri/target/debug/dropkick`,
      commandLine: "",
    })).toBe(true);
    expect(ownsProcess({
      pid: 11,
      parentPid: 1,
      executablePath: `${REPO_ROOT}/src-tauri/target/release/bundle/macos/Dropkick.app/Contents/MacOS/dropkick`,
      commandLine: "",
    })).toBe(true);
    expect(ownsProcess({
      pid: 12,
      parentPid: 1,
      executablePath: "/another/repo/src-tauri/target/debug/dropkick",
      commandLine: "",
    })).toBe(false);
  });

  it("does not let a stale launcher generation clean up its replacement", async () => {
    const first = `first-${randomUUID()}`;
    const second = `second-${randomUUID()}`;
    try {
      await claimRuntime(first);
      await claimRuntime(second);
      expect(await isRuntimeOwner(first)).toBe(false);
      expect(await isRuntimeOwner(second)).toBe(true);
    } finally {
      await releaseRuntime(second);
    }
  });
});

// The launchers name the bundle and executable they start; those names are the
// manifests' (tauri.conf.json productName, Cargo package name), checked here.
describe("launcher names", () => {
  it("match the manifests the build takes them from", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const productName = JSON.parse(readFileSync(join(REPO_ROOT, "src-tauri/tauri.conf.json"), "utf8")).productName;
    const crate = /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms.exec(readFileSync(join(REPO_ROOT, "src-tauri/Cargo.toml"), "utf8"))![1];
    const scripts = readdirSync(join(REPO_ROOT, "scripts")).filter((name) => /\.(command|ps1|sh)$/.test(name));
    const found: string[] = [];
    for (const name of scripts) {
      const text = readFileSync(join(REPO_ROOT, "scripts", name), "utf8");
      for (const match of text.matchAll(/^(?:APP_NAME="([^"]+)"|\$AppName = "([^"]+)")/gm)) { found.push(name); expect(match[1] ?? match[2]).toBe(productName); }
      for (const match of text.matchAll(/^(?:APP_EXECUTABLE="([^"]+)"|\$[cC]rate = "([^"]+)")/gm)) {
        found.push(name);
        expect(match[1] ?? match[2]).toBe(crate);
      }
    }
    // The check fails rather than passing on nothing if the launchers stop naming them this way.
    expect(found.length).toBeGreaterThanOrEqual(8);
  });
});
