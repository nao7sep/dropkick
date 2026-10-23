import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const directory = await mkdtemp(join(tmpdir(), "dropkick-launcher-test-"));
    const ownerFile = join(directory, "runtime.owner");
    const first = `first-${randomUUID()}`;
    const second = `second-${randomUUID()}`;
    try {
      await claimRuntime(first, ownerFile);
      await claimRuntime(second, ownerFile);
      expect(await isRuntimeOwner(first, ownerFile)).toBe(false);
      expect(await isRuntimeOwner(second, ownerFile)).toBe(true);
    } finally {
      await releaseRuntime(second, ownerFile);
      await rm(directory, { recursive: true, force: true });
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
  it("keeps simultaneous launcher fixtures independent", async () => {
    const directories = await Promise.all([0, 1].map(() => mkdtemp(join(tmpdir(), "dropkick-launcher-test-"))));
    const files = directories.map((directory) => join(directory, "runtime.owner"));
    try {
      await Promise.all(files.map((file, index) => claimRuntime(`fixture-${index}`, file)));
      expect(await isRuntimeOwner("fixture-0", files[0])).toBe(true);
      expect(await isRuntimeOwner("fixture-1", files[1])).toBe(true);
      await releaseRuntime("fixture-0", files[0]);
      expect(await isRuntimeOwner("fixture-1", files[1])).toBe(true);
    } finally {
      await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
    }
  });

});


it("a retiring generation cannot unlink a concurrently published successor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dropkick-launcher-test-"));
  const ownerFile = join(directory, "runtime.owner");
  try {
    await claimRuntime("old", ownerFile);
    const retiring = releaseRuntime("old", ownerFile);
    await claimRuntime("new", ownerFile);
    await retiring;
    expect(await isRuntimeOwner("new", ownerFile)).toBe(true);
    // Even release of the current generation leaves a complete stale selector.
    await releaseRuntime("new", ownerFile);
    expect(await readFile(ownerFile, "utf8")).toBe("new\n");
    await Promise.all(Array.from({ length: 20 }, (_, i) => claimRuntime(`parallel-${i}`, ownerFile)));
    expect(await readFile(ownerFile, "utf8")).toMatch(/^parallel-\d+\n$/);
    expect((await readdir(directory)).some(name => name.endsWith(".tmp"))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("waits for an owned process's graceful decision and cleans only recorded support identities after exit", async () => {
  const { fork } = await import("node:child_process");
  const { once } = await import("node:events");
  const { writeFile } = await import("node:fs/promises");
  // @ts-expect-error Direct ESM launcher helper.
  const { launcherEndpoint, recordSupport, stopRuntime } = await import("../../scripts/launcher-runtime.mjs");
  const directory = await mkdtemp(join(tmpdir(), "dropkick-launcher-test-"));
  const ownerFile = join(directory, "runtime.owner");
  const child = fork(new URL("../helpers/launcher-child.mjs", import.meta.url), { execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = once(child, "exit");
  try {
    const [{ port }] = await once(child, "message");
    const gui = { pid: child.pid!, parentPid: 101, created: "fixture-gui", executablePath: `${REPO_ROOT}/src-tauri/target/debug/dropkick`, commandLine: "" };
    const support = { pid: 101, parentPid: 1, created: "original-support", executablePath: "node", commandLine: "vite" };
    const unrelated = { pid: 102, parentPid: 1, created: "independent", executablePath: "node", commandLine: "vite" };
    let current = [gui, support, unrelated];
    const inspect = async () => current.filter(item => item.pid !== child.pid || child.exitCode === null);
    const signals: number[] = [];
    await claimRuntime("fixture", ownerFile);
    await recordSupport("fixture", 101, ownerFile, inspect);
    await writeFile(launcherEndpoint("fixture", ownerFile), JSON.stringify({ port, pid: child.pid, generation: "fixture", secret: "fixture-secret", root: "/fixture" }));
    const requested = once(child, "message");
    const cancelled = stopRuntime("fixture", ownerFile, { inspect, expectedRoot: "/fixture", signal: async (pid: number) => { signals.push(pid); } });
    const cancellation = expect(cancelled).rejects.toThrow("cancelled");
    await requested;
    expect(signals).toEqual([]);
    child.send("cancel");
    await cancellation;
    expect(await isRuntimeOwner("fixture", ownerFile)).toBe(true);
    expect(child.exitCode).toBeNull();
    // A reused support PID is not authority, and an independent matching name
    // was never captured under the owned root.
    current = [gui, { ...support, created: "reused-support" }, unrelated];
    const nextRequest = once(child, "message");
    const stopping = stopRuntime("fixture", ownerFile, { inspect, expectedRoot: "/fixture", signal: async (pid: number) => { signals.push(pid); } });
    await nextRequest;
    expect(signals).toEqual([]);
    child.send("accept");
    await Promise.all([stopping, exited]);
    expect(signals).toEqual([]);
    expect(await readFile(ownerFile, "utf8")).toBe("fixture\n");
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

it("cleanup stops only the captured generation's support after GUI exit and leaves a successor intact", async () => {
  const { writeFile } = await import("node:fs/promises");
  // @ts-expect-error Direct ESM launcher helper.
  const { launcherEndpoint, recordSupport, stopRuntime } = await import("../../scripts/launcher-runtime.mjs");
  const directory = await mkdtemp(join(tmpdir(), "dropkick-launcher-test-"));
  const ownerFile = join(directory, "runtime.owner");
  const gui = { pid: 301, parentPid: 300, created: "gui", executablePath: `${REPO_ROOT}/src-tauri/target/debug/dropkick`, commandLine: "" };
  const support = { pid: 300, parentPid: 1, created: "support", executablePath: "node", commandLine: "npm" };
  let current = [gui, support];
  const events: string[] = [];
  try {
    await claimRuntime("retiring", ownerFile);
    await recordSupport("retiring", 300, ownerFile, async () => current);
    await writeFile(launcherEndpoint("retiring", ownerFile), JSON.stringify({ pid: 301, generation: "retiring", root: "/fixture" }));
    await stopRuntime("retiring", ownerFile, {
      inspect: async () => current,
      expectedRoot: "/fixture",
      close: async () => {
        events.push("close"); current = [support];
        await claimRuntime("successor", ownerFile);
      },
      signal: async (pid: number) => { events.push(`support:${pid}`); current = current.filter(item => item.pid !== pid); },
    });
    expect(events).toEqual(["close", "support:300"]);
    expect(await isRuntimeOwner("successor", ownerFile)).toBe(true);
    expect(await readdir(directory)).toContain("runtime.owner.successor");
  } finally { await rm(directory, { recursive: true, force: true }); }
});


it("scopes launcher ownership to the same expanded home-relative data root as the app", async () => {
  // @ts-expect-error Direct ESM launcher helper.
  const { launcherRoot } = await import("../../scripts/launcher-runtime.mjs");
  const { resolve } = await import("node:path");
  expect(launcherRoot({}, "/fixture/home")).toBe(resolve("/fixture/home/.dropkick"));
  expect(launcherRoot({ DROPKICK_DATA_DIR: "  ${ROOT}/~literal  ", ROOT: "profiles" }, "/fixture/home")).toBe(resolve("/fixture/home/profiles/~literal"));
  expect(launcherRoot({ DROPKICK_DATA_DIR: "~/%PROFILE%", PROFILE: "private" }, "/fixture/home")).toBe(resolve("/fixture/home/private"));
  expect(() => launcherRoot({ DROPKICK_DATA_DIR: "$ABSENT" }, "/fixture/home")).toThrow("empty path");
});
