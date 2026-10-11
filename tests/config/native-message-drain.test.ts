// The behavioral policy is tested in Rust on every host; this checks only
// that the Windows adapter uses that policy and preserves native quit wiring.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("connects the Windows queue and real settlement flag to the tested wait policy", () => {
  const source = readFileSync(new URL("../../src-tauri/src/os_quit.rs", import.meta.url), "utf8");
  const adapter = source.slice(source.indexOf("fn wait_for_window()"));
  expect(adapter).toMatch(/wait_for_settlement\(\s*Instant::now\(\) \+ SESSION_END_WAIT,\s*\|\| SESSION_END_PENDING.load\(Ordering::SeqCst\),\s*Instant::now,\s*wait_for_input,\s*dispatch_one,/);
  expect(adapter).toContain('Outcome::TimedOut => release_session("timed out")');
  expect(adapter).toContain('Outcome::Quit => release_session("quit")');
  expect(adapter).toMatch(/msg.message == WM_QUIT[\s\S]*?PostQuitMessage\(msg.wparam as i32\);\s*return Message::Quit/);
});
