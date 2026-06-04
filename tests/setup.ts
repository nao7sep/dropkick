// Vitest global setup.
//
// Several utilities (utils/zoom, utils/shortcuts) decide the platform primary
// modifier (Cmd vs. Ctrl) from navigator.platform *at module load*. The default
// `node` environment has no `navigator`, so those modules fall back to "" (treated
// as non-Apple). Tests that need a specific platform reset the module registry and
// stub navigator themselves (see test/helpers/platform.ts); this file only makes
// sure a bare `navigator` exists so module load never throws under `node`.

import { vi } from "vitest";

if (typeof globalThis.navigator === "undefined") {
  vi.stubGlobal("navigator", { platform: "", userAgent: "" });
}
