import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A plain #[tauri::command] runs INLINE on the thread that drives the webview.
// For a command that touches the filesystem that means the window freezes for
// the length of the call - three fsyncs and a SQLite insert per save, and up to
// the backup store's five-second busy timeout when a write is contended. The
// attribute on a sync function is what dispatches it to Tauri's thread pool.
//
// The list of which commands need it is DERIVED from what each body actually
// does, not hand-maintained: a hand-kept list goes stale the moment a command
// is added, which is the failure this guard exists to prevent.
const source = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)),
  "utf8",
);

// Everything before the test module, so #[cfg(test)] helpers are not scanned.
const shipped = source.slice(0, source.indexOf("\n#[cfg(test)]"));

interface Command {
  attribute: string;
  name: string;
  body: string;
  touchesDisk: boolean;
}

function commands(): Command[] {
  const found: Command[] = [];
  const attr = /#\[tauri::command(\([^)]*\))?\]\s*\n\s*(?:async\s+)?fn\s+(\w+)/g;
  let match: RegExpExecArray | null;
  const starts: { index: number; attribute: string; name: string }[] = [];
  while ((match = attr.exec(shipped)) !== null) {
    starts.push({
      index: match.index,
      attribute: match[1] ?? "",
      name: match[2],
    });
  }
  for (let i = 0; i < starts.length; i += 1) {
    // Bound the body at the function's own closing brace (column 0, which is
    // how rustfmt lays out a top-level fn) rather than at the next command, so
    // the last one does not swallow the rest of the file.
    const from = starts[i].index;
    const close = shipped.indexOf("\n}\n", from);
    const body = shipped.slice(from, close === -1 ? shipped.length : close);
    found.push({
      attribute: starts[i].attribute,
      name: starts[i].name,
      body,
      // Direct filesystem use, or the helpers that reach it.
      touchesDisk:
        /std::fs::/.test(body) ||
        /write_atomic\(/.test(body) ||
        /paths::data_root\(/.test(body),
    });
  }
  return found;
}

const all = commands();

describe("Tauri command dispatch (src-tauri/src/lib.rs)", () => {
  it("finds the shipped commands", () => {
    // A regex that matched nothing would make every assertion below vacuous.
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.some((c) => c.name === "write_text_file_atomic")).toBe(true);
  });

  it("runs every filesystem command off the UI thread", () => {
    const inline = all
      .filter((c) => c.touchesDisk && !c.attribute.includes("async"))
      .map((c) => c.name);
    expect(inline).toEqual([]);
  });

  it("keeps log_event inline, so log lines cannot be reordered", () => {
    // The logger writes one unbuffered line per call and is cheap; dispatching
    // it to a pool would let concurrent events land out of order in the file.
    const logEvent = all.find((c) => c.name === "log_event");
    expect(logEvent).toBeDefined();
    expect(logEvent?.attribute).toBe("");
  });
});
