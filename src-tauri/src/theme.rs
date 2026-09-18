//! The saved appearance choice, applied natively (app-chrome conventions,
//! Theme). The window theme is the one theme authority: it paints the title bar
//! and drives the webview's prefers-color-scheme, which App.css's dark block
//! follows. It is applied before the window is first shown — from the
//! preferences document the startup picker will preview — and again on every
//! Save, together with the window background behind the page.

use std::path::Path;

use serde_json::Value;
use tauri::window::Color;
use tauri::{Theme, WebviewWindow};

/// The window theme for a preference value: `Some` for "light" or "dark",
/// `None` (follow the OS) for anything else.
pub fn window_theme_for(preference: &str) -> Option<Theme> {
    match preference {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// The window theme a preferences document asks for, by the same rule as the
/// frontend's normalizeThemePreference: a valid `theme` wins, a document without
/// one keeps the released `darkMode` boolean's choice, and anything else follows
/// the OS.
pub fn preferences_window_theme(preferences: &Value) -> Option<Theme> {
    match preferences.get("theme").and_then(Value::as_str) {
        Some(preference @ ("system" | "light" | "dark")) => window_theme_for(preference),
        _ => match preferences.get("darkMode").and_then(Value::as_bool) {
            Some(true) => Some(Theme::Dark),
            Some(false) => Some(Theme::Light),
            None => None,
        },
    }
}

/// The preferences document the startup picker previews: state.json's
/// `lastLaunchedPreferencesPath`, or `lastPreferencesPath` in a state file
/// written before that field existed — the same fallback the frontend's
/// app-state migration applies.
pub fn last_launched_preferences_path(state: &Value) -> Option<&str> {
    let path = match state.get("lastLaunchedPreferencesPath") {
        Some(value) => value.as_str()?,
        None => state.get("lastPreferencesPath")?.as_str()?,
    };
    (!path.is_empty()).then_some(path)
}

/// Reads the saved choice without touching either file. Anything missing,
/// unreadable, or unparseable follows the OS; recovery stays with the
/// frontend's load path.
pub fn read_saved_window_theme(state_file: &Path) -> Option<Theme> {
    let state: Value = serde_json::from_str(&std::fs::read_to_string(state_file).ok()?).ok()?;
    let preferences_path = last_launched_preferences_path(&state)?;
    let preferences: Value =
        serde_json::from_str(&std::fs::read_to_string(preferences_path).ok()?).ok()?;
    preferences_window_theme(&preferences)
}

/// The window background behind the page — App.css's --background in each
/// theme — so the frames before the page paints and the backing exposed while
/// resizing already match.
pub fn window_background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x17, 0x17, 0x17, 0xff),
        _ => Color(0xf9, 0xfa, 0xfb, 0xff),
    }
}

/// Applies a window theme (`None` follows the OS) and the matching background.
pub fn apply(window: &WebviewWindow, theme: Option<Theme>) -> Result<(), String> {
    window.set_theme(theme).map_err(|error| error.to_string())?;
    let effective = match theme {
        Some(theme) => theme,
        None => window.theme().map_err(|error| error.to_string())?,
    };
    window
        .set_background_color(Some(window_background(effective)))
        .map_err(|error| error.to_string())
}
