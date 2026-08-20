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
});
