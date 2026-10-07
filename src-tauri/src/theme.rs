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

use crate::format_version::{self, Format, Marker};

/// The window theme for a preference value: `Some` for "light" or "dark",
/// `None` (follow the OS) for anything else.
pub fn window_theme_for(preference: &str) -> Option<Theme> {
    match preference {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// An absent or invalid theme follows the OS, without rewriting the document.
pub fn preferences_window_theme(preferences: &Value) -> Option<Theme> {
    preferences.get("theme").and_then(Value::as_str).and_then(window_theme_for)
}

/// The preferences document the startup picker previews: state.json's
/// `lastLaunchedPreferencesPath`.
pub fn last_launched_preferences_path(state: &Value) -> Option<&str> {
    let path = state.get("lastLaunchedPreferencesPath")?.as_str()?;
    (!path.is_empty()).then_some(path)
}

/// The preferences document the startup picker will preview, read without
/// touching it or state.json. Anything missing, unreadable, unparseable, or
/// written by a newer build is None; recovery stays with the frontend's load
/// path.
pub fn previewed_preferences(state_file: &Path) -> Option<Value> {
    let state_file = state_file.to_path_buf();
    crate::native_wait::run(state_file.to_string_lossy().into_owned(), move || {
        Ok(previewed_preferences_owned(&state_file))
    })
    .ok()
    .flatten()
}

fn previewed_preferences_owned(state_file: &Path) -> Option<Value> {
    let state = readable_document(state_file, Format::State)?;
    let preferences_path = last_launched_preferences_path(&state)?;
    readable_document(Path::new(preferences_path), Format::Preferences)
}

fn readable_document(path: &Path, format: Format) -> Option<Value> {
    let document: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    matches!(format_version::json_value(&document, format), Ok(Marker::Readable)).then_some(document)
}

/// The saved choice; without one the window follows the OS.
pub fn read_saved_window_theme(state_file: &Path) -> Option<Theme> {
    preferences_window_theme(&previewed_preferences(state_file)?)
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
