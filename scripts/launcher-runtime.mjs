import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, unlink, writeFile, rename, mkdir, rmdir } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");
// Match paths::resolve_root's environment/tilde expansion and home-relative
// meaning. Namespace launcher ownership by the selected app data root too.
export function launcherRoot(environment = process.env, home = homedir()) {
  const raw = environment.DROPKICK_DATA_DIR?.trim();
  if (!raw) return resolve(home, ".dropkick");
  let expanded = raw.replace(/\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([^%]*)%/g,
    (_match, braces, plain, windows) => environment[braces ?? plain ?? windows] ?? "").trim();
  if (!expanded) throw new Error("DROPKICK_DATA_DIR expands to an empty path.");
  if (expanded === "~") expanded = home;
  else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) expanded = join(home, expanded.slice(2));
  return resolve(home, expanded);
}
const APP_ROOT = launcherRoot();
const OWNER_FILE = join(
  tmpdir(),
  `company-launcher-${createHash("sha256").update(`${REPO_ROOT}\n${APP_ROOT}`).digest("hex").slice(0, 20)}.owner`,
);

// Dropkick's runtime identity, read from its manifests: the product name the
// macOS bundle carries and the crate name its executable takes.
export const IDENTITY = {
  label: JSON.parse(readFileSync(join(REPO_ROOT, "src-tauri/tauri.conf.json"), "utf8")).productName,
  executable: /^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms.exec(readFileSync(join(REPO_ROOT, "src-tauri/Cargo.toml"), "utf8"))[1],
};

function normalized(value) {
  return normalize(value ?? "").replaceAll("\\", "/").toLowerCase();
}

function underRoot(value) {
  const candidate = normalized(value);
  const root = normalized(REPO_ROOT);
  return candidate === root || candidate.startsWith(`${root}/`) || candidate.includes(`${root}/`);
}

export function ownsProcess(processInfo, identity = IDENTITY) {
  const executable = normalized(processInfo.executablePath);
  const command = normalized(processInfo.commandLine);
  const combined = `${executable}\n${command}`;
  if (!underRoot(executable) && !underRoot(command)) return false;
  if (combined.includes("/scripts/run-dev.command")
    || combined.includes("/scripts/run-dev.ps1")
    || combined.includes("/scripts/run-built.command")
    || combined.includes("/scripts/run-built.ps1")
    || combined.includes("/scripts/rebuild.command")
    || combined.includes("/scripts/rebuild.ps1")) {
    return true;
  }

  // The Tauri CLI and its Vite dev server, a debug or release build, or the
  // packaged macOS bundle (a Windows build matches target/*/dropkick.exe).
  const executableName = identity.executable.toLowerCase();
  return combined.includes("/node_modules/.bin/tauri")
    || combined.includes("/node_modules/@tauri-apps/cli/")
    || combined.includes("/node_modules/.bin/vite")
    || combined.includes("/node_modules/vite/")
    || combined.includes(`/target/debug/${executableName}`)
    || combined.includes(`/target/release/${executableName}`)
    || combined.includes(`/${identity.label.toLowerCase()}.app/contents/macos/${executableName}`);
}

function parsePosixProcesses(stdout) {
  return stdout.trim().split("\n").filter(Boolean).map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s+(.*)$/.exec(line);
    if (!match) return undefined;
    return {
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      executablePath: "",
      created: match[3],
      commandLine: match[4],
    };
  }).filter(Boolean);
}

async function listProcesses() {
  if (process.platform !== "win32") {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,lstart=,command="], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePosixProcesses(stdout);
  }

  const script = [
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script,
  ], {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const decoded = JSON.parse(stdout || "[]");
  const rows = Array.isArray(decoded) ? decoded : [decoded];
  return rows.map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    created: String(row.CreationDate),
    executablePath: row.ExecutablePath ?? "",
    commandLine: row.CommandLine ?? "",
  }));
}

function descendantsOf(processes, roots) {
  const selected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) {
      if (selected.has(item.parentPid) && !selected.has(item.pid)) {
        selected.add(item.pid);
        changed = true;
      }
    }
  }
  return selected;
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function publishText(ownerFile, text) {
  // Publish a complete generation selector. Retiring generations never unlink
  // this shared name, so their completion cannot remove a successor's claim.
  const stage = `${ownerFile}.${randomUUID()}.tmp`;
  try {
    await writeFile(stage, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(stage, ownerFile);
  } finally {
    try { await unlink(stage); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

export async function claimRuntime(token, ownerFile = OWNER_FILE) {
  // Exclusive private generation storage is the authority for its endpoint and
  // support records; a pre-existing directory is never adopted.
  const directory = dirname(generationPath(token, "endpoint", ownerFile));
  await mkdir(directory, { mode: 0o700 });
  try { await publishText(ownerFile, `${token}\n`); }
  catch (error) { await rmdir(directory); throw error; }
}

export async function isRuntimeOwner(token, ownerFile = OWNER_FILE) {
  try {
    return (await readFile(ownerFile, "utf8")).trim() === token;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function releaseRuntime(token, ownerFile = OWNER_FILE) {
  // A stale selector is harmless. This query is for caller diagnostics only;
  // never turn it into authority to delete the pathname after an await.
  return isRuntimeOwner(token, ownerFile);
}

function generationPath(token, suffix, ownerFile = OWNER_FILE) {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid launcher generation.");
  return join(`${ownerFile}.${token}`, suffix);
}
export const launcherEndpoint = (token, ownerFile = OWNER_FILE) => generationPath(token, "endpoint", ownerFile);
const supportFile = (token, ownerFile = OWNER_FILE) => generationPath(token, "support", ownerFile);

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function isGui(item, identity = IDENTITY) {
  const value = normalized(`${item.executablePath} ${item.commandLine}`);
  return value.includes(`target/debug/${identity.executable}`)
    || value.includes(`target/release/${identity.executable}`)
    || value.includes(`/${identity.label.toLowerCase()}.app/contents/macos/${identity.executable}`);
}
const sameProcess = (a, b) => a.pid === b.pid && a.created === b.created;

// Called with the PID returned by the launcher's own spawn, never a name match.
// Its descendants are captured while that exact creation identity is alive.
export async function recordSupport(token, pid, ownerFile = OWNER_FILE, inspect = listProcesses) {
  const processes = await inspect();
  const file = supportFile(token, ownerFile);
  const previous = JSON.parse(await readOptional(file) ?? "null");
  const root = processes.find(item => item.pid === pid);
  if (!root || (previous && !sameProcess(previous.root, root))) return;
  const descendants = descendantsOf(processes, [pid]);
  const members = processes.filter(item => descendants.has(item.pid) && !isGui(item))
    .map(({ pid, created }) => ({ pid, created }));
  await publishText(file, JSON.stringify({ root: { pid: root.pid, created: root.created }, members }));
}

// Heartbeats mean the app is still handling its ordinary close flow. There is
// no grace-period kill: a stalled/unreachable endpoint refuses replacement.
export async function requestGracefulClose(endpoint, connect = createConnection) {
  return new Promise((resolveClose, rejectClose) => {
    const socket = connect({ host: "127.0.0.1", port: endpoint.port });
    let buffered = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; socket.destroy();
      if (error) rejectClose(error); else resolveClose();
    };
    socket.setTimeout(5000);
    socket.once("timeout", () => finish(new Error("The app's close endpoint stopped answering. Close the app normally, then try again.")));
    socket.once("error", error => finish(new Error(`The app cannot be closed safely: ${error.message}. Close it normally, then try again.`)));
    socket.once("connect", () => socket.write(`close___${JSON.stringify({ generation: endpoint.generation, secret: endpoint.secret, root: endpoint.root })}\n`));
    socket.on("data", bytes => {
      buffered += bytes.toString();
      if (buffered.length > 1024) return finish(new Error("Invalid close response."));
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const response = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        if (response === "pending") continue;
        if (response === "accepted") return finish();
        return finish(new Error(response === "cancelled" ? "Replacement cancelled; the app and its work remain open." : "The running app refused replacement; close it normally, then try again."));
      }
    });
    // Process exit can close the socket before its final reply is delivered.
    // The caller still must prove that the original process actually exited.
    socket.once("end", () => finish());
  });
}

async function stopRecordedSupport(record, inspect, signal) {
  for (const member of [...record.members].reverse()) {
    const current = (await inspect()).find(item => sameProcess(item, member));
    if (!current || isGui(current)) continue;
    await signal(current.pid);
  }
  const deadline = Date.now() + 5000;
  while ((await inspect()).some(item => record.members.some(member => sameProcess(item, member)) && !isGui(item))) {
    if (Date.now() >= deadline) throw new Error("Recorded support processes have not exited; replacement stopped without touching the app.");
    await delay(100);
  }
}
async function signalSupport(pid) {
  if (process.platform === "win32") await execFileAsync("taskkill.exe", ["/PID", String(pid), "/F"], { timeout: 5000 });
  else { try { process.kill(pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; } }
}

export async function stopRuntime(token, ownerFile = OWNER_FILE, operations = {}) {
  const inspect = operations.inspect ?? listProcesses;
  const close = operations.close ?? requestGracefulClose;
  const signal = operations.signal ?? signalSupport;
  const endpointText = await readOptional(launcherEndpoint(token, ownerFile));
  const supportText = await readOptional(supportFile(token, ownerFile));
  const endpoint = endpointText ? JSON.parse(endpointText) : null;
  if (endpoint && (endpoint.generation !== token || resolve(endpoint.root) !== resolve(operations.expectedRoot ?? APP_ROOT))) {
    throw new Error("Launcher endpoint root or generation does not match.");
  }
  const processes = await inspect();
  const gui = endpoint && processes.find(item => item.pid === endpoint.pid);
  if (gui) {
    // The authenticated per-generation endpoint is ownership authority; a path
    // match alone never permits stopping any process.
    await close(endpoint);
    const deadline = Date.now() + 10000;
    while ((await inspect()).some(item => sameProcess(item, gui))) {
      if (Date.now() >= deadline) throw new Error("The app has not exited. Its support processes were left running; close it normally before relaunching.");
      await delay(100);
    }
  } else if (!endpoint && processes.some(item => ownsProcess(item) && isGui(item))) {
    throw new Error("The running app has no matching launcher close endpoint. Close it normally before relaunching.");
  }
  if (supportText) await stopRecordedSupport(JSON.parse(supportText), inspect, signal);
  // Only this captured generation's disposable records are removed. The shared
  // selector is deliberately retained even when this was its latest generation.
  for (const file of [launcherEndpoint(token, ownerFile), supportFile(token, ownerFile)]) {
    try { await unlink(file); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  try { await rmdir(dirname(launcherEndpoint(token, ownerFile))); }
  catch (error) { if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error; }
}

async function stopSelected() {
  const token = (await readOptional(OWNER_FILE))?.trim();
  if (token) await stopRuntime(token);
  else if ((await listProcesses()).some(item => ownsProcess(item) && isGui(item))) {
    throw new Error("An independently launched app is running. Close it normally before selecting a launcher mode.");
  }
}

async function waitForOwned(token, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await readOptional(launcherEndpoint(token))) return;
    await delay(100);
  }
  throw new Error("This launcher did not establish an owned app session. Close any independently launched instance and try again.");
}

async function assertEndpointAvailable(host, port) {
  await new Promise((resolveProbe, rejectProbe) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error) => {
      rejectProbe(new Error(
        `Cannot bind ${host}:${port}: ${error.code ?? error.message}. The listener was left running because its app identity is unknown.`,
      ));
    });
    probe.listen({ host, port, exclusive: true }, () => {
      probe.close((error) => error ? rejectProbe(error) : resolveProbe());
    });
  });
}

async function waitForHttp(url, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`${url} did not become ready within ${timeoutMilliseconds} ms (${lastError}).`);
}

async function waitForExecutable(executablePath, timeoutMilliseconds) {
  const expected = normalized(resolve(executablePath));
  const repoRelativeExpected = normalized(relative(REPO_ROOT, expected));
  const targetMarker = expected.lastIndexOf("/target/");
  const targetRelativeExpected = targetMarker >= 0 ? expected.slice(targetMarker + 1) : "";
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const processes = await listProcesses();
    const byPid = new Map(processes.map((item) => [item.pid, item]));
    const found = processes.some((item) => {
      const executable = normalized(item.executablePath);
      const command = normalized(item.commandLine);
      if (executable === expected || command === expected || command.startsWith(expected + " ")) return true;
      const relativeMatch = command === repoRelativeExpected
        || command.startsWith(repoRelativeExpected + " ")
        || (targetRelativeExpected && (
          command === targetRelativeExpected || command.startsWith(targetRelativeExpected + " ")
        ));
      if (!relativeMatch) return false;
      let parent = byPid.get(item.parentPid);
      while (parent) {
        if (underRoot(parent.executablePath) || underRoot(parent.commandLine)) return true;
        parent = byPid.get(parent.parentPid);
      }
      return false;
    });
    if (found) return;
    await delay(100);
  }
  throw new Error(`${executablePath} did not start within ${timeoutMilliseconds} ms.`);
}


async function main(args) {
  const command = args.shift();
  if (command === "claim") {
    const token = args.shift();
    if (!token) throw new Error("Expected claim <token>.");
    await claimRuntime(token);
    return;
  }
  if (command === "is-owner") {
    const token = args.shift();
    if (!token) throw new Error("Expected is-owner <token>.");
    if (!await isRuntimeOwner(token)) process.exitCode = 3;
    return;
  }
  if (command === "release-if-owner") {
    const token = args.shift();
    if (!token) throw new Error("Expected release-if-owner <token>.");
    await releaseRuntime(token);
    return;
  }
  if (command === "stop") {
    await stopSelected();
    return;
  }
  if (command === "stop-if-owner") {
    const token = args.shift();
    if (!token) throw new Error("Expected stop-if-owner <token>.");
    if (!await isRuntimeOwner(token)) return;
    await stopRuntime(token);
    await releaseRuntime(token);
    return;
  }
  if (command === "endpoint-path") {
    process.stdout.write(launcherEndpoint(args.shift()) + "\n");
    return;
  }
  if (command === "record-support") {
    const token = args.shift(), pid = Number(args.shift());
    if (!token || !Number.isInteger(pid) || pid <= 0) throw new Error("Expected record-support <token> <pid>.");
    await recordSupport(token, pid); return;
  }
  if (command === "wait-owned") {
    const token = args.shift();
    if (!token) throw new Error("Expected wait-owned <token> [timeout-ms].");
    await waitForOwned(token, Number(args.shift() ?? "30000")); return;
  }
  if (command === "check-endpoint") {
    const host = args.shift();
    const port = Number(args.shift());
    if (!host || !Number.isInteger(port)) throw new Error("Expected check-endpoint <host> <port>.");
    await assertEndpointAvailable(host, port);
    return;
  }
  if (command === "wait-http") {
    const url = args.shift();
    const timeout = Number(args.shift() ?? "60000");
    if (!url || !Number.isFinite(timeout)) throw new Error("Expected wait-http <url> [timeout-ms].");
    await waitForHttp(url, timeout);
    return;
  }
  if (command === "wait-process") {
    const executablePath = args.shift();
    const timeout = Number(args.shift() ?? "30000");
    if (!executablePath || !Number.isFinite(timeout)) throw new Error("Expected wait-process <executable-path> [timeout-ms].");
    await waitForExecutable(executablePath, timeout);
    return;
  }
  throw new Error("Expected one of: claim, is-owner, release-if-owner, stop, stop-if-owner, check-endpoint, wait-http, wait-process.");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
