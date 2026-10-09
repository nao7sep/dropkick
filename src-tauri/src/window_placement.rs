use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, PhysicalPosition, PhysicalSize, Window, WindowEvent, Wry};

use crate::format_version::{self, Format, Marker};
use crate::{logging, paths, write_atomic_unrecorded};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalRectangle {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub normal: NormalRectangle,
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClosingState {
    Normal(NormalRectangle),
    Maximized,
    Transient,
}

pub fn placement_after_close(
    previous: Option<Placement>,
    closing: ClosingState,
    remember_maximized: bool,
) -> Option<Placement> {
    match closing {
        ClosingState::Normal(normal) => Some(Placement {
            normal,
            maximized: false,
        }),
        ClosingState::Maximized => previous.map(|placement| Placement {
            normal: placement.normal,
            maximized: remember_maximized,
        }),
        ClosingState::Transient => previous,
    }
}

/// One durable window whose placement is remembered, in its own volatile-state
/// file: the main window, and the Records window.
pub(crate) struct TrackedWindow {
    label: &'static str,
    file_name: &'static str,
    state: Mutex<Option<Placement>>,
    // Set when a newer build wrote the file: this session never writes it.
    left_in_place: AtomicBool,
}

impl TrackedWindow {
    fn new(label: &'static str, file_name: &'static str) -> Self {
        TrackedWindow {
            label,
            file_name,
            state: Mutex::new(None),
            left_in_place: AtomicBool::new(false),
        }
    }
}

/// A placement file as it is written: its format version, then the placement.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlacementFile {
    format_version: u32,
    #[serde(flatten)]
    placement: Placement,
}

/// What a placement file holds for this build.
#[derive(Debug, PartialEq, Eq)]
pub enum SavedPlacement {
    Absent,
    Found(Placement),
    /// Written by a newer build; read nothing and leave it as it is.
    Newer(u64),
}

pub(crate) struct WindowPlacements {
    pub(crate) main: TrackedWindow,
    pub(crate) records: TrackedWindow,
}

impl WindowPlacements {
    pub(crate) fn new() -> Self {
        WindowPlacements {
            main: TrackedWindow::new("main", paths::WINDOW_FILE_NAME),
            records: TrackedWindow::new(crate::records_window::LABEL, paths::RECORDS_WINDOW_FILE_NAME),
        }
    }

    fn all(&self) -> [&TrackedWindow; 2] {
        [&self.main, &self.records]
    }
}

fn current_rectangle(window: &Window<Wry>) -> tauri::Result<NormalRectangle> {
    let position = window.outer_position()?;
    let size = window.inner_size()?;
    Ok(NormalRectangle {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn usable(window: &Window<Wry>, rectangle: NormalRectangle) -> tauri::Result<bool> {
    if rectangle.width == 0 || rectangle.height == 0 {
        return Ok(false);
    }
    let left = i64::from(rectangle.x);
    let top = i64::from(rectangle.y);
    let right = left + i64::from(rectangle.width);
    let bottom = top + i64::from(rectangle.height);
    Ok(window.available_monitors()?.iter().any(|monitor| {
        let area = monitor.work_area();
        let area_left = i64::from(area.position.x);
        let area_top = i64::from(area.position.y);
        left < area_left + i64::from(area.size.width)
            && right > area_left
            && top < area_top + i64::from(area.size.height)
            && bottom > area_top
    }))
}

fn set_state(tracked: &TrackedWindow, placement: Option<Placement>) {
    match tracked.state.lock() {
        Ok(mut current) => *current = placement,
        Err(error) => logging::warn(
            "window placement lock is unavailable",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}

fn state_value(tracked: &TrackedWindow) -> Option<Placement> {
    match tracked.state.lock() {
        Ok(current) => *current,
        Err(error) => {
            logging::warn(
                "window placement lock is unavailable",
                serde_json::json!({ "error": error.to_string() }),
            );
            None
        }
    }
}

/// Reads a placement file. An unreadable one is quarantined and reads as
/// absent; a newer build's file is left exactly as it is.
pub fn load_file(path: &Path) -> Result<SavedPlacement, String> {
    let path = path.to_path_buf();
    crate::native_wait::run(path.to_string_lossy().into_owned(), move || {
        load_file_owned(&path)
    })
}

fn load_file_owned(path: &Path) -> Result<SavedPlacement, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SavedPlacement::Absent)
        }
        Err(error) => return Err(error.to_string()),
    };
    let parsed = match format_version::json_bytes(&bytes, Format::WindowPlacement) {
        Ok(Marker::Newer(found)) => return Ok(SavedPlacement::Newer(found)),
        Ok(Marker::Readable) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) => Err(error),
    };
    match parsed {
        Ok(placement) => Ok(SavedPlacement::Found(placement)),
        Err(error) => {
            let quarantined = crate::set_aside(path)?;
            logging::warn(
                "invalid window placement was set aside",
                serde_json::json!({
                    "error": error,
                    "quarantinedTo": quarantined.to_string_lossy(),
                }),
            );
            Ok(SavedPlacement::Absent)
        }
    }
}

fn load(app: &AppHandle, tracked: &TrackedWindow) -> Result<Option<Placement>, String> {
    let app = app.clone();
    let root = crate::native_wait::run("app-paths".to_string(), move || paths::data_root(&app))?;
    let path = root.join(tracked.file_name);
    match load_file(&path)? {
        SavedPlacement::Absent => Ok(None),
        SavedPlacement::Found(placement) => Ok(Some(placement)),
        SavedPlacement::Newer(found) => {
            tracked.left_in_place.store(true, Ordering::Relaxed);
            logging::warn(
                "window placement is newer than this build; left in place and not written this session",
                serde_json::json!({ "file": path.to_string_lossy(), "formatVersion": found }),
            );
            Ok(None)
        }
    }
}

// Applies the window's remembered placement to it while it is still hidden. A
// window reopened in the same session takes the placement it closed with,
// which is saved only at exit.
pub(crate) fn restore(app: &AppHandle, window: &Window<Wry>, tracked: &TrackedWindow) {
    let fallback = current_rectangle(window).ok().map(|normal| Placement {
        normal,
        maximized: false,
    });
    let remembered = match state_value(tracked) {
        Some(placement) => Ok(Some(placement)),
        None => load(app, tracked),
    };
    let saved = match remembered {
        Ok(saved) => saved,
        Err(error) => {
            logging::warn(
                "window placement could not be loaded",
                serde_json::json!({ "error": error }),
            );
            None
        }
    };
    let usable = saved.and_then(|placement| match usable(window, placement.normal) {
        Ok(true) => Some(placement),
        Ok(false) => None,
        Err(error) => {
            logging::warn(
                "window placement could not be validated",
                serde_json::json!({ "error": error.to_string() }),
            );
            None
        }
    });
    let mut restored = fallback;
    if let Some(placement) = usable {
        let normal = placement.normal;
        let result = window
            .set_position(PhysicalPosition::new(normal.x, normal.y))
            .and_then(|()| window.set_size(PhysicalSize::new(normal.width, normal.height)));
        if let Err(error) = result {
            logging::warn(
                "window placement could not be restored",
                serde_json::json!({ "error": error.to_string() }),
            );
            if let Some(default) = fallback {
                let _ =
                    window.set_position(PhysicalPosition::new(default.normal.x, default.normal.y));
                let _ = window.set_size(PhysicalSize::new(
                    default.normal.width,
                    default.normal.height,
                ));
            }
        } else {
            restored = Some(Placement {
                normal,
                maximized: cfg!(target_os = "windows") && placement.maximized,
            });
            if cfg!(target_os = "windows") && placement.maximized {
                if let Err(error) = window.maximize() {
                    logging::warn(
                        "maximized window state could not be restored",
                        serde_json::json!({ "error": error.to_string() }),
                    );
                }
            }
        }
    }
    set_state(tracked, restored);
}

pub(crate) fn capture(window: &Window<Wry>, tracked: &TrackedWindow) {
    let closing = (|| -> tauri::Result<ClosingState> {
        if window.is_minimized()? || window.is_fullscreen()? {
            return Ok(ClosingState::Transient);
        }
        if window.is_maximized()? {
            return Ok(ClosingState::Maximized);
        }
        Ok(ClosingState::Normal(current_rectangle(window)?))
    })();
    match closing {
        Ok(closing) => set_state(
            tracked,
            placement_after_close(state_value(tracked), closing, cfg!(target_os = "windows")),
        ),
        Err(error) => logging::warn(
            "window placement could not be captured",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}

pub(crate) fn on_window_event(window: &Window<Wry>, event: &WindowEvent, placements: &WindowPlacements) {
    if !matches!(event, WindowEvent::CloseRequested { .. }) {
        return;
    }
    if let Some(tracked) = placements.all().into_iter().find(|t| t.label == window.label()) {
        capture(window, tracked);
    }
}

// Writes every placement this session holds. A window never opened this
// session holds none, and its file is left as it is.
pub(crate) fn save_all(app: &AppHandle, placements: &WindowPlacements) {
    for tracked in placements.all() {
        save(app, tracked);
    }
}

/// The text a placement file holds.
pub fn file_text(placement: Placement) -> Result<String, String> {
    let file = PlacementFile {
        format_version: Format::WindowPlacement.current(),
        placement,
    };
    let mut text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text)
}

fn save(app: &AppHandle, tracked: &TrackedWindow) {
    if tracked.left_in_place.load(Ordering::Relaxed) {
        return;
    }
    let Some(placement) = state_value(tracked) else {
        return;
    };
    let app = app.clone();
    let file_name = tracked.file_name;
    let result = crate::native_wait::run(
        format!("placement:{file_name}"),
        move || -> Result<(), String> {
            let root = paths::data_root(&app)?;
            let path = root.join(file_name);
            write_atomic_unrecorded(&path.to_string_lossy(), &file_text(placement)?).map(|_| ())
        },
    );
    if let Err(error) = result {
        logging::warn(
            "window placement could not be saved",
            serde_json::json!({ "window": tracked.label, "error": error }),
        );
    }
}

#[cfg(test)]
#[path = "../tests/unit/window_placement.rs"]
mod tests;
