// Quit must reach the webview's close path.
//
// Tauri's predefined Quit maps to `terminate:` on macOS, which nothing in tao,
// wry or tauri intercepts: Cmd+Q then exits with a focused title or
// description never blurred and queued task-list writes never drained. The menu
// therefore carries the app's own Quit item, and the app routes it to a window
// close (src-tauri/src/menu.rs). This pins both halves so a later menu rebuild
// cannot quietly bring the predefined item back.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../src-tauri/src/${path}`, import.meta.url)), "utf8");
}

describe("native menu Quit", () => {
  it("is the app's own item, not the predefined terminate: item", () => {
    const menu = source("menu.rs");
    expect(menu).not.toMatch(/PredefinedMenuItem::quit\b/);
    expect(menu).toMatch(/MenuItem::with_id\(app, QUIT_ID,/);
  });

  it("closes the main window rather than exiting", () => {
    const menu = source("menu.rs");
    const lib = source("lib.rs");
    expect(lib).toMatch(/event\.id\(\)\.as_ref\(\) == menu::QUIT_ID[\s\S]{0,80}menu::request_quit\(app\)/);
    expect(menu).toMatch(/fn request_quit[\s\S]*?window\.close\(\)/);
  });
});
