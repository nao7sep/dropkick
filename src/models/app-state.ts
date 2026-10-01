// Disposable app-level view adjustments and last selections in state.json.

export interface AppStateDto {
  version: string;
  lastPreferencesPath: string; // startup-picker selection
  lastLaunchedPreferencesPath: string; // last preferences used to enter main; startup-theme source
  lastWorkspacePath: string;
  zoomLevel: number; // 0.5–5.0 (1.0 = 100%); kept in sync with ZOOM_DEFAULT (utils/zoom)
  sidebarWidth: number; // sidebar intent width in PIXELS — the width the user last dragged it to; the displayed width is clamp(SIDEBAR_MIN, intent, maxFit) — see DEFAULT_SIDEBAR_WIDTH / clampSidebarWidth in utils/windowSizing
}

export function createDefaultAppState(): AppStateDto {
  return {
    version: "1.0.0",
    lastPreferencesPath: "",
    lastLaunchedPreferencesPath: "",
    lastWorkspacePath: "",
    zoomLevel: 1.0, // kept in sync with ZOOM_DEFAULT (utils/zoom)
    sidebarWidth: 320, // sidebar intent width in px; kept in sync with DEFAULT_SIDEBAR_WIDTH (utils/windowSizing)
  };
}
