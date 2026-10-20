// The contract between os_quit.rs and the window's close path: the event the
// core sends at the end of a session, and the bound it waits for the window,
// which must outlast the window's own and stay under what Windows allows. The
// decisions themselves are tested in src-tauri/tests/unit/os_quit.rs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOSE_WAIT_MS } from "../../src/hooks/use-window-close";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
}

const osQuit = source("src-tauri/src/os_quit.rs");

describe("OS quit routes", () => {
  it("name the event the window listens for", () => {
    const repository = source("src/repositories/session-end.ts");
    const event = /SESSION_ENDING_EVENT: &str = "([^"]+)"/.exec(osQuit)?.[1];
    expect(event).toBeDefined();
    expect(repository).toContain(`const SESSION_ENDING = "${event}"`);
  });

  it("wait longer than the window's own bound and less than Windows allows", () => {
    const wait = Number(/SESSION_END_WAIT: Duration = Duration::from_millis\((\d+)\)/.exec(osQuit)?.[1]);
    expect(wait).toBeGreaterThan(CLOSE_WAIT_MS);
    expect(wait).toBeLessThan(5000);
  });
});
