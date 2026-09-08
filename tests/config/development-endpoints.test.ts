import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string): string => readFileSync(root + path, "utf8");
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  build: { devUrl: string };
  app: { security: { devCsp: string } };
};

describe("development endpoints", () => {
  it("keeps Vite, HMR, Tauri, and both launchers on the app-owned ports", () => {
    expect(read("vite.config.ts")).toContain("port: 29327");
    expect(read("vite.config.ts")).toContain("port: 22853");
    expect(read("vite.config.ts")).toContain('remoteHost ?? "127.0.0.1"');
    expect(tauri.build.devUrl).toBe("http://127.0.0.1:29327");
    expect(tauri.app.security.devCsp).toContain("http://127.0.0.1:29327");
    for (const path of ["scripts/run-dev.command", "scripts/run-dev.ps1"]) {
      expect(read(path)).toContain("29327");
      expect(read(path)).toContain("22853");
      expect(read(path)).not.toMatch(/stop[_-]port|Stop-Port/);
    }
  });
});
