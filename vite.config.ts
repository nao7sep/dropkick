/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available.
  //    Bumped from the 1420/1421 scaffold default so it never collides with a
  //    sibling Tauri app's launcher port-kill (quickdeck uses 1621).
  server: {
    port: 1521,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1522,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Unit tests run on Vitest, reusing this same Vite pipeline (TS, ESM,
  // path resolution). Default environment is `node` since the bulk of the
  // suite is pure logic in src/services and src/utils; specs that touch the
  // DOM or read navigator.platform opt into happy-dom with a per-file
  // `// @vitest-environment happy-dom` comment.
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      // V8's native coverage for the frontend (the Rust backend has its own
      // cargo-llvm-cov pass). `include` spans src so the report flags logic no
      // test reaches, not just a score for what is reached.
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // Excluded as framework wiring with no decision to cover:
      exclude: [
        "src/main.tsx", // React DOM mount
        "src/vite-env.d.ts",
        "**/*.d.ts",
      ],
    },
  },
}));
