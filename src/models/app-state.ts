// App-level state stored at ~/.dropkick/state.json
// Remembers known workspace/preferences files, last selections, and the current
// view adjustments (zoom, sidebar width) — all rebuildable, so this is state
// rather than durable configuration.
//
// zoomLevel and sidebarWidth are VIEW STATE, not preferences: they are adjusted
// live by dragging the divider or hitting a zoom shortcut, they are machine-/
// display-specific, and a "reset preferences" must not touch them
// (persisted-store-separation-conventions). They live here — one app-level value
// per machine — rather than in the portable, per-document preferences file, so a
// sidebar width dragged on a wide monitor never rides along when a preferences
// document is copied to a laptop.

export interface AppStateDto {
  version: string;
  lastPreferencesPath: string; // startup-picker selection
  lastLaunchedPreferencesPath: string; // last preferences used to enter main; startup-theme source
  lastWorkspacePath: string;
  knownPreferences: string[]; // absolute paths
  knownWorkspaces: string[]; // absolute paths
  zoomLevel: number; // 0.5–5.0 (1.0 = 100%); kept in sync with ZOOM_DEFAULT (utils/zoom)
  sidebarWidth: number; // sidebar intent width in PIXELS — the width the user last dragged it to; the displayed width is clamp(SIDEBAR_MIN, intent, maxFit) — see DEFAULT_SIDEBAR_WIDTH / clampSidebarWidth in utils/windowSizing
}

export function createDefaultAppState(): AppStateDto {
  return {
    version: "1.0.0",
    lastPreferencesPath: "",
    lastLaunchedPreferencesPath: "",
    lastWorkspacePath: "",
    knownPreferences: [],
    knownWorkspaces: [],
    zoomLevel: 1.0, // kept in sync with ZOOM_DEFAULT (utils/zoom)
    sidebarWidth: 320, // sidebar intent width in px; kept in sync with DEFAULT_SIDEBAR_WIDTH (utils/windowSizing)
  };
}
