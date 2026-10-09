import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A plain synchronous #[tauri::command] runs INLINE on the thread that drives
// the webview, so a command that touches the filesystem would freeze the window
// for the length of the call. Tagging a synchronous function `async` only moves
// it onto an async-runtime worker, which stalled storage can exhaust. Every
// filesystem command is therefore an `async fn` that hands its disk work to
// native_wait::settle, whose own test (src-tauri/tests/native_wait.rs) shows that
// stalled work holds up no other command; this guard checks that each command
// actually goes through it.
//
// The list of which commands need it is DERIVED from what each body actually
// does, not hand-maintained: a hand-kept list goes stale the moment a command
// is added, which is the failure this guard exists to prevent.
const source = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)),
  "utf8",
).replace(/\r\n?/g, "\n");

// Everything before the test module, so #[cfg(test)] helpers are not scanned.
const shipped = source.slice(0, source.indexOf("\n#[cfg(test)]"));

interface Command {
  attribute: string;
  isAsync: boolean;
  name: string;
  body: string;
  touchesDisk: boolean;
}

function commands(input = shipped): Command[] {
  const found: Command[] = [];
  const attr = /#\[tauri::command(\([^)]*\))?\]\s*\n\s*(async\s+)?fn\s+(\w+)/g;
  let match: RegExpExecArray | null;
  const starts: { index: number; attribute: string; isAsync: boolean; name: string }[] = [];
  while ((match = attr.exec(input)) !== null) {
    starts.push({
      index: match.index,
      attribute: match[1] ?? "",
      isAsync: match[2] !== undefined,
      name: match[3],
    });
  }
  for (let i = 0; i < starts.length; i += 1) {
    // Bound the body at the function's own closing brace (column 0, which is
    // how rustfmt lays out a top-level fn) rather than at the next command, so
    // the last one does not swallow the rest of the file.
    const from = starts[i].index;
    const close = input.indexOf("\n}\n", from);
    const body = input.slice(from, close === -1 ? input.length : close);
    found.push({
      attribute: starts[i].attribute,
      isAsync: starts[i].isAsync,
      name: starts[i].name,
      body,
      // Direct filesystem use, or the helpers that reach it.
      touchesDisk:
        /std::fs::/.test(body) ||
        /write_atomic(?:_unrecorded)?\(/.test(body) ||
        /paths::data_root\(/.test(body),
    });
  }
  return found;
}

const all = commands();

// A command whose disk work does not go through settle, from an async fn.
function unsettled(found: Command[]): string[] {
  return found
    .filter((c) => c.touchesDisk && !(c.isAsync && c.body.includes("native_wait::settle(")))
    .map((c) => c.name);
}

describe("Tauri command dispatch (src-tauri/src/lib.rs)", () => {
  it("detects a command that reaches the disk without settle", () => {
    const planted = commands(
      "#[tauri::command]\nfn inline_save() {\n    write_atomic_unrecorded(path, contents);\n}\n" +
        "#[tauri::command(async)]\nfn worker_save() {\n    write_atomic(path, contents);\n}\n" +
        "#[tauri::command]\nasync fn settled_save() {\n    native_wait::settle(move || write_atomic(path, contents)).await\n}\n",
    );
    expect(unsettled(planted)).toEqual(["inline_save", "worker_save"]);
  });
  it("finds the shipped commands", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.some((c) => c.name === "write_text_file_atomic")).toBe(true);
  });

  it("runs every filesystem command through settle", () => {
    expect(unsettled(all)).toEqual([]);
  });

  it("writes log records off the UI thread", () => {
    // The frontend sends one entry at a time (src/repositories/logging.ts), so
    // the pool cannot reorder them.
    const logEvent = all.find((c) => c.name === "log_event");
    expect(logEvent).toBeDefined();
    expect(logEvent?.attribute).toContain("async");
  });
});
