import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guard the main window's capability grants, the way the CSP test guards the
// policy. A capability file is easy to widen by reflex — reaching for a
// plugin's `:default` set to make one call work grants everything else in it —
// and nothing else in the suite would notice.
//
// The one that matters here is the opener. The production CSP gives the
// renderer no network egress, so `open_url` handing a URL to the OS browser is
// the single channel that can carry data off the machine. `opener:default`
// grants every `http://*`, `https://*`, `mailto:*` and `tel:*` URL, plus
// `reveal_item_in_dir` which this app never calls; the app opens exactly two
// links, both to its own repository.
const capability = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../src-tauri/capabilities/default.json", import.meta.url),
    ),
    "utf8",
  ),
) as { permissions?: unknown[] };

const permissions = capability.permissions ?? [];

function scopedPermission(identifier: string) {
  return permissions.find(
    (p): p is { identifier: string; allow?: { url?: string }[] } =>
      typeof p === "object" && p !== null && "identifier" in p &&
      (p as { identifier: unknown }).identifier === identifier,
  );
}

describe("Tauri window capability (src-tauri/capabilities/default.json)", () => {
  it("grants the mutating window calls used by the frontend", () => {
    for (const permission of [
      "core:window:allow-destroy",
      "core:window:allow-set-title",
      "core:window:allow-set-theme",
      "core:window:allow-set-min-size",
    ]) {
      expect(permissions).toContain(permission);
    }
  });

  it("does not grant a plugin's whole default set for the opener", () => {
    expect(permissions).not.toContain("opener:default");
    expect(permissions).not.toContain("opener:allow-reveal-item-in-dir");
    // Unscoped would enable open_url for every URL.
    expect(permissions).not.toContain("opener:allow-open-url");
    expect(permissions).not.toContain("opener:allow-default-urls");
  });

  it("scopes open_url to the app's own repository links", () => {
    const opener = scopedPermission("opener:allow-open-url");
    expect(opener).toBeDefined();
    expect(opener?.allow).toEqual([
      { url: "https://github.com/nao7sep/dropkick*" },
    ]);
  });

  it("grants no shell, http, or filesystem plugin permission", () => {
    // All file I/O goes through this app's own commands, so no fs plugin scope
    // should ever appear here; the app runs no external process and makes no
    // outbound request.
    const identifiers = permissions.map((p) =>
      typeof p === "string" ? p : (p as { identifier?: string }).identifier ?? "",
    );
    for (const prefix of ["fs:", "shell:", "http:", "upload:", "process:"]) {
      expect(identifiers.filter((id) => id.startsWith(prefix))).toEqual([]);
    }
  });

  it("keeps window-state operations outside the frontend capability", () => {
    const identifiers = permissions.map((p) =>
      typeof p === "string" ? p : (p as { identifier?: string }).identifier ?? "",
    );
    expect(identifiers.filter((id) => id.startsWith("window-state:"))).toEqual([]);
  });
});

describe("durable window-state boundary", () => {
  const core = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/lib.rs", import.meta.url)),
    "utf8",
  );
  const placement = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/window_placement.rs", import.meta.url)),
    "utf8",
  );
  const appRoot = readFileSync(
    fileURLToPath(new URL("../../src/App.tsx", import.meta.url)),
    "utf8",
  );
  const tauriConfig = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../src-tauri/tauri.conf.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as { app: { windows: Array<{ visible?: boolean }> } };

  it("restores the atomic native record before showing Main", () => {
    expect(core).toContain("window_placement::restore(");
    expect(core).toContain("window.show()?");
    expect(core.indexOf("window_placement::restore(")).toBeLessThan(core.indexOf("window.show()?"));
    expect(core).not.toContain("tauri_plugin_window_state");
    expect(placement).not.toMatch(/Moved|Resized|debounce|prev_[xy]/i);
  });

  it("keeps placement out of the frontend and creates Main hidden", () => {
    expect(appRoot).not.toMatch(/plugin-window-state|restoreState|saveWindowState/);
    expect(tauriConfig.app.windows[0]?.visible).toBe(false);
  });
});
