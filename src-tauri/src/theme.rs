//! The saved appearance choice, applied natively (app-chrome conventions,
//! Theme). The window theme is the one theme authority: it paints the title bar
//! and drives the webview's prefers-color-scheme, which App.css's dark block
//! follows. It is applied before the window is first shown — from the
//! app-wide settings — and again on every
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
pub fn settings_window_theme(settings: &Value) -> Option<Theme> {
    settings.get("theme").and_then(Value::as_str).and_then(window_theme_for)
}

/// The first-paint choices from the app-wide settings.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Appearance {
    pub language: Option<&'static str>,
    pub theme: Option<Theme>,
}

// One immutable preview supplies both first-paint choices. The frontend still
// owns full validation; this read never rewrites the file.
pub fn read_appearance(state_file: &Path) -> Appearance {
    let settings = previewed_settings(state_file);
    Appearance {
        language: settings.as_ref().and_then(crate::i18n::saved_preference),
        theme: settings.as_ref().and_then(settings_window_theme),
    }
}

fn previewed_settings(state_file: &Path) -> Option<Value> {
    let paths = crate::paths::app_paths(state_file.parent()?);
    readable_document(Path::new(&paths.settings_file), Format::Settings)
}

fn readable_document(path: &Path, format: Format) -> Option<Value> {
    let document: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    matches!(format_version::json_value(&document, format), Ok(Marker::Readable)).then_some(document)
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

#[cfg(test)]
#[path = "../tests/unit/theme.rs"]
mod tests;

/// The OS appearance right now, whatever theme this window is held to: the
/// Settings "System" entry names what it would resolve to (app-chrome
/// conventions, Theme). The window's own theme cannot say, because a Light or
/// Dark choice overrides it, so this asks the OS setting itself. `None` where
/// the platform has no such setting to read.
pub fn system_theme() -> Option<&'static str> {
    platform_system_theme()
}

// macOS keeps the current appearance in the global AppleInterfaceStyle
// default: "Dark" while dark (also when switching automatically), absent while
// light.
#[cfg(target_os = "macos")]
fn platform_system_theme() -> Option<&'static str> {
    use objc2_foundation::{NSString, NSUserDefaults};
    let style = NSUserDefaults::standardUserDefaults().stringForKey(&NSString::from_str("AppleInterfaceStyle"));
    Some(match style {
        Some(style) if style.to_string() == "Dark" => "dark",
        _ => "light",
    })
}

// Windows keeps it as the AppsUseLightTheme DWORD under the current user's
// Personalize key: 0 for dark, 1 (or absent) for light.
#[cfg(windows)]
fn platform_system_theme() -> Option<&'static str> {
    use std::ffi::c_void;
    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            key: isize,
            sub_key: *const u16,
            value: *const u16,
            flags: u32,
            kind: *mut u32,
            data: *mut c_void,
            data_len: *mut u32,
        ) -> i32;
    }
    // HKEY_CURRENT_USER is ((HKEY)(ULONG_PTR)((LONG)0x80000001)), sign-extended.
    const HKEY_CURRENT_USER: isize = 0x8000_0001_u32 as i32 as isize;
    const RRF_RT_REG_DWORD: u32 = 0x0000_0010;
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let sub_key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let value = wide("AppsUseLightTheme");
    let mut data: u32 = 1;
    let mut len = std::mem::size_of::<u32>() as u32;
    // SAFETY: both names are NUL-terminated and outlive the call; the buffer is
    // a DWORD and its size is passed.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            sub_key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut data as *mut u32).cast(),
            &mut len,
        )
    };
    Some(if status == 0 && data == 0 { "dark" } else { "light" })
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_system_theme() -> Option<&'static str> {
    None
}
