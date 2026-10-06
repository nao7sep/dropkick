// The quits the OS starts must reach the webview's close path too
// (unsaved-edits-conventions, Quitting).
//
// Dock > Quit and the end of a macOS session arrive as `terminate:`, which
// nothing in tao or Tauri intercepts, and tao answers a Windows WM_ENDSESSION
// by ending the event loop; either way the app used to exit without the
// webview hearing of it. src-tauri/src/os_quit.rs routes them, and this pins
// its wiring and its bound, which no unit test can reach without a real
// AppKit or Win32 session. What the window does once asked is tested in
// tests/hooks/use-window-close.test.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOSE_WAIT_MS } from "../../src/hooks/use-window-close";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
}

const osQuit = source("src-tauri/src/os_quit.rs");
const lib = source("src-tauri/src/lib.rs");

describe("OS quit routes", () => {
  it("are hooked once the main window exists, and the window can report back", () => {
    expect(lib).toMatch(/window\.show\(\)\?;\s*\}\s*os_quit::install\(app\.handle\(\)\);/);
    expect(lib).toMatch(/fn session_end_settled\(\)\s*\{\s*os_quit::session_end_settled\(\);/);
    expect(lib).toMatch(/generate_handler!\[[\s\S]*\bsession_end_settled\b[\s\S]*\]/);
  });

  it("send Dock > Quit through the menu's Quit and keep the app running for it", () => {
    expect(osQuit).toMatch(/sel!\(applicationShouldTerminate:\)/);
    expect(osQuit).toMatch(/menu::request_quit\(app\);\s*TERMINATE_CANCEL/);
  });

  it("let the end of a macOS session wait for the window, within the bound", () => {
    expect(osQuit).toMatch(
      /if session_is_ending\(\) \{[\s\S]*?begin_session_end\(app\)[\s\S]*?sleep\(SESSION_END_WAIT\)[\s\S]*?TERMINATE_LATER/,
    );
    expect(osQuit).toMatch(/replyToApplicationShouldTerminate: Bool::YES/);
  });

  it("ask the window at a Windows session's end before tao ends the loop", () => {
    expect(osQuit).toMatch(
      /msg == WM_QUERYENDSESSION[\s\S]*?begin_session_end\(app\)[\s\S]*?wait_for_window\(\)/,
    );
  });

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

  it("take the placement of windows the end of a session leaves open", () => {
    expect(lib).toMatch(/RunEvent::Exit = event \{[\s\S]*?capture_open_windows\(app_handle\);\s*window_placement::save_all/);
  });
});
