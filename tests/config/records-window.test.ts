// The Records window's native wiring (src-tauri/src/records_window.rs and
// lib.rs): the app-owned decisions window-conventions asks to be checked in
// source, since a native window manager is not mocked.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
}

const recordsWindow = source("src-tauri/src/records_window.rs");
const lib = source("src-tauri/src/lib.rs");
const shipped = lib.slice(0, lib.indexOf("\n#[cfg(test)]"));
const placement = source("src-tauri/src/window_placement.rs");
const openBody = recordsWindow.slice(recordsWindow.indexOf("pub fn open("), recordsWindow.indexOf("\n}\n", recordsWindow.indexOf("pub fn open(")));

describe("the Records window", () => {
  it("is one window: opening it again brings the open one forward", () => {
    expect(recordsWindow).toContain('pub const LABEL: &str = "records";');
    const lookup = openBody.indexOf("app.get_webview_window(LABEL)");
    const build = openBody.indexOf("WebviewWindowBuilder::new(");
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(build);
    expect(openBody.slice(lookup, build)).toMatch(/set_focus\(\)/);
    // Two requests at once cannot both build it.
    expect(openBody.indexOf("OPENING.lock()")).toBeLessThan(lookup);
  });

  it("is built hidden and placed before it is first shown", () => {
    const hidden = openBody.indexOf(".visible(false)");
    const restore = openBody.indexOf("window_placement::restore(");
    const show = openBody.lastIndexOf("window.show()");
    expect(hidden).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(hidden);
    expect(show).toBeGreaterThan(restore);
    expect(openBody).toMatch(/\.min_inner_size\(context\.min_width, context\.min_height\)/);
  });

  it("keeps its own placement, through the app's one placement owner", () => {
    expect(placement).toMatch(/records: TrackedWindow::new\(crate::records_window::LABEL, paths::RECORDS_WINDOW_FILE_NAME\)/);
    expect(openBody).toContain("&placements.records");
    expect(shipped).toMatch(/RunEvent::Exit[\s\S]*window_placement::save_all\(/);
    expect(shipped).toMatch(/get_webview_window\(records_window::LABEL\)[\s\S]{0,120}window_placement::capture\(/);
  });

  it("closes with the main window, so it never keeps the app running", () => {
    expect(shipped).toMatch(
      /window\.label\(\) == "main" && matches!\(event, tauri::WindowEvent::Destroyed\)[\s\S]{0,80}records_window::close_with_main\(/,
    );
    const close = recordsWindow.slice(recordsWindow.indexOf("pub fn close_with_main("));
    expect(close.indexOf("window_placement::capture(")).toBeLessThan(close.indexOf("window.destroy()"));
  });

  it("lets a Dock click bring the main window back while it is open", () => {
    expect(shipped).toMatch(/RunEvent::Reopen \{ \.\. \} = event[\s\S]{0,40}reopen_main\(app_handle\)/);
    const reopen = shipped.slice(shipped.indexOf("fn reopen_main("));
    expect(reopen).toMatch(/get_webview_window\("main"\)/);
    expect(reopen).toMatch(/unminimize\(\)/);
  });

  it("is signalled after each stored record", () => {
    expect(shipped).toMatch(/logging::on_stored\(move \|\| records_window::notify_changed\(&handle\)\)/);
  });

  it("reads records without writing a record of its own success", () => {
    const reader = shipped.slice(shipped.indexOf("fn read_records<T>("), shipped.indexOf("fn read_records_page("));
    expect(reader).toContain("log_cmd_err(");
    expect(reader).not.toMatch(/log_cmd_start|log_cmd_ok|logging::(info|debug|warn)\(/);
    for (const command of ["read_records_page", "read_record_sources", "read_record_detail"]) {
      const at = shipped.indexOf(`fn ${command}(`);
      const body = shipped.slice(at, shipped.indexOf("\n}\n", at));
      expect(shipped.slice(at - 40, at)).toContain("#[tauri::command(async)]");
      expect(body).toContain(`read_records("${command}"`);
      expect(body).not.toMatch(/log_cmd_start|log_cmd_ok|logging::(info|debug|warn|error)\(/);
    }
  });

  it("has a capability of its own that grants only its events and its title", () => {
    const capability = JSON.parse(source("src-tauri/capabilities/records.json")) as {
      windows: string[];
      permissions: string[];
    };
    expect(capability.windows).toEqual(["records"]);
    expect(capability.permissions.sort()).toEqual([
      "core:event:allow-emit-to",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-set-title",
    ]);
  });

  it("is a page of its own in the build", () => {
    expect(source("vite.config.ts")).toMatch(/records: "records\.html"/);
    expect(source("records.html")).toContain('src="/src/records-main.tsx"');
  });
});
