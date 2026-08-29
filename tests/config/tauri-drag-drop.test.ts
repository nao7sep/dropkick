import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../src-tauri/tauri.conf.json", import.meta.url)),
    "utf8",
  ),
) as { app?: { windows?: Array<{ dragDropEnabled?: unknown }> } };

describe("Tauri native file interception", () => {
  it("is explicitly the primary OS file-drop boundary", () => {
    expect(config.app?.windows).toHaveLength(1);
    expect(config.app?.windows?.[0]?.dragDropEnabled).toBe(true);
  });
});
