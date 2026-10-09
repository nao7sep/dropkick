//! The Records window: a durable secondary window that shows records.sqlite3,
//! with its own placement (window-conventions, Placement). There is only ever
//! one; opening it again brings it forward. It never outlives the main
//! window, so it neither keeps the app running after the main window closes
//! nor stands in for the main window when the app is reactivated.

use std::sync::Mutex;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::{i18n, logging, theme, window_placement};

pub const LABEL: &str = "records";

/// Sent to the Records window after each record the database stored.
pub const CHANGED_EVENT: &str = "records-changed";

// The designed initial size, in logical pixels.
const INITIAL_WIDTH: f64 = 1200.0;
const INITIAL_HEIGHT: f64 = 760.0;

/// What the main window hands the Records window when it opens it: the window
/// minimum its panes add up to, the list width the user last chose, and the
/// interface settings the main window holds. The page reads all but the
/// minimum from its address, so its first frame already has them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordsWindowContext {
    pub min_width: f64,
    pub min_height: f64,
    pub list_width: f64,
    pub language: String,
    pub locale: String,
    pub time_zone: Option<String>,
    pub theme: String,
}

/// The page's address, with the context it starts from.
pub fn page_url(context: &RecordsWindowContext) -> String {
    let mut url = Url::parse("tauri://localhost/records.html").expect("a fixed, valid URL");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("listWidth", &context.list_width.round().to_string());
        query.append_pair("language", &context.language);
        query.append_pair("locale", &context.locale);
        if let Some(zone) = &context.time_zone {
            query.append_pair("timeZone", zone);
        }
    }
    format!("records.html?{}", url.query().unwrap_or_default())
}

// One open at a time, so two quick requests cannot both find no window and
// both build one (PLAYBOOK, Own the work in flight).
static OPENING: Mutex<()> = Mutex::new(());

pub fn open(app: &AppHandle, context: &RecordsWindowContext) -> Result<(), String> {
    let _opening = OPENING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(window) = app.get_webview_window(LABEL) {
        if window.is_minimized().map_err(|e| e.to_string())? {
            window.unminimize().map_err(|e| e.to_string())?;
        }
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }

    let language = i18n::normalize_preference(Some(&context.language)).unwrap_or("en");
    let title = i18n::catalogue(language).text("records.title", &app.package_info().name);
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(page_url(context).into()))
        .title(title)
        .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
        .min_inner_size(context.min_width, context.min_height)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    if let Err(error) = theme::apply(&window, theme::window_theme_for(&context.theme)) {
        logging::warn(
            "records window theme apply failed",
            json!({ "error": error }),
        );
    }
    let placements = app.state::<window_placement::WindowPlacements>();
    window_placement::restore(app, &window.as_ref().window(), &placements.records);
    // Shown whether or not the placement could be restored.
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

/// Tells the Records window, when it is open, that a record was stored. It
/// runs on whichever thread wrote the record, so a failure goes to stderr: a
/// logged one would be stored, and signal again.
pub fn notify_changed(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_none() {
        return;
    }
    if let Err(error) = app.emit_to(LABEL, CHANGED_EVENT, ()) {
        eprintln!("[dropkick:records] records window signal failed: {error}");
    }
}

/// Applies the main window's new theme to the Records window, when it is open.
pub fn apply_theme(app: &AppHandle, preference: &str) -> Result<(), String> {
    match app.get_webview_window(LABEL) {
        Some(window) => theme::apply(&window, theme::window_theme_for(preference)),
        None => Ok(()),
    }
}

/// Closes the Records window with the main window. Tauri keeps the app
/// running while any window is open, and the main window's close is how the
/// app quits, so the Records window must not outlive it.
pub fn close_with_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let placements = app.state::<window_placement::WindowPlacements>();
    window_placement::capture(&window.as_ref().window(), &placements.records);
    if let Err(error) = window.destroy() {
        logging::warn(
            "records window close failed",
            json!({ "error": error.to_string() }),
        );
        app.exit(0);
    }
}

#[cfg(test)]
#[path = "../tests/unit/records_window.rs"]
mod tests;
