//! The native menu, in the interface language. It has the same items as
//! Tauri's default menu, which Dropkick used before it was localized, except
//! that Quit is the app's own item (see `QUIT_ID`).

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::Wry;
use tauri::{AppHandle, Manager};

use crate::logging;
use serde_json::json;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::i18n;

/// The id of the app-owned Quit item.
///
/// The predefined Quit maps to `terminate:` on macOS, and nothing in tao, wry
/// or tauri implements `applicationShouldTerminate:`, so it exits without ever
/// reaching the webview: a title or description still focused never blurs and
/// never commits, and writes still queued in the webview are dropped. This item
/// instead asks the main window to close, which is the one exit the webview
/// sees (`CloseRequested`), so Cmd+Q and the menu's Quit finish pending work
/// exactly as the red close button does. Dock > Quit and the end of a session
/// still arrive as `terminate:`, and `os_quit` routes them to the same close.
pub const QUIT_ID: &str = "dropkick-quit";

/// Quits through the main window's close path, or exits directly when there is
/// no window to close.
pub fn request_quit(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        app.exit(0);
        return;
    };
    if let Err(error) = window.close() {
        logging::warn("quit: window close failed", json!({ "error": error.to_string() }));
    }
}

/// What differs between the macOS and Windows menus, apart from building them,
/// so both layouts are checked on either host.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows", test)), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub struct Layout {
    /// macOS: Quit Dropkick (Cmd+Q); Windows: Exit, with no shortcut — Alt+F4
    /// closes the window through the same close path.
    pub quit_key: &'static str,
    pub quit_accelerator: Option<&'static str>,
    /// Windows keeps Exit under File; macOS keeps Quit in the app menu.
    pub quit_in_file: bool,
    /// Windows keeps About under Help; macOS keeps it in the app menu.
    pub about_in_help: bool,
    /// macOS only: the app menu (About, Services, Hide, Hide Others, Quit) and
    /// View > Enter Full Screen.
    pub app_menu: bool,
    /// macOS calls Maximize "Zoom".
    pub maximize_key: &'static str,
    /// macOS separates Close Window from the window-sizing items.
    pub window_separator: bool,
}

#[cfg_attr(not(any(target_os = "macos", target_os = "windows", test)), allow(dead_code))]
pub fn layout(macos: bool) -> Layout {
    Layout {
        quit_key: if macos { "nativeMenu.quit" } else { "nativeMenu.exit" },
        quit_accelerator: if macos { Some("CmdOrCtrl+Q") } else { None },
        quit_in_file: !macos,
        about_in_help: !macos,
        app_menu: macos,
        maximize_key: if macos { "nativeMenu.zoom" } else { "nativeMenu.maximize" },
        window_separator: macos,
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<Wry>> {
    let layout = layout(cfg!(target_os = "macos"));
    let name = app.package_info().name.clone();
    let text = i18n::catalogue(language);
    let t = |key: &str| text.text(key, &name);
    let config = app.config();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(app, QUIT_ID, t(layout.quit_key), true, layout.quit_accelerator)?;
    let about_item = PredefinedMenuItem::about(app, Some(&t("nativeMenu.about")), Some(about))?;

    let close_window = PredefinedMenuItem::close_window(app, Some(&t("nativeMenu.closeWindow")))?;
    let mut file_items: Vec<&dyn IsMenuItem<Wry>> = vec![&close_window];
    if layout.quit_in_file {
        file_items.push(&quit);
    }
    let file = Submenu::with_items(app, t("nativeMenu.file"), true, &file_items)?;
    let edit = Submenu::with_items(
        app,
        t("nativeMenu.edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&t("nativeMenu.undo")))?,
            &PredefinedMenuItem::redo(app, Some(&t("nativeMenu.redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&t("nativeMenu.cut")))?,
            &PredefinedMenuItem::copy(app, Some(&t("nativeMenu.copy")))?,
            &PredefinedMenuItem::paste(app, Some(&t("nativeMenu.paste")))?,
            &PredefinedMenuItem::select_all(app, Some(&t("nativeMenu.selectAll")))?,
        ],
    )?;
    let minimize = PredefinedMenuItem::minimize(app, Some(&t("nativeMenu.minimize")))?;
    let maximize = PredefinedMenuItem::maximize(app, Some(&t(layout.maximize_key)))?;
    let window_separator = PredefinedMenuItem::separator(app)?;
    let window_close = PredefinedMenuItem::close_window(app, Some(&t("nativeMenu.closeWindow")))?;
    let mut window_items: Vec<&dyn IsMenuItem<Wry>> = vec![&minimize, &maximize];
    if layout.window_separator {
        window_items.push(&window_separator);
    }
    window_items.push(&window_close);
    let window = Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, t("nativeMenu.window"), true, &window_items)?;
    let mut help_items: Vec<&dyn IsMenuItem<Wry>> = Vec::new();
    if layout.about_in_help {
        help_items.push(&about_item);
    }
    let help = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, t("nativeMenu.help"), true, &help_items)?;

    if !layout.app_menu {
        return Menu::with_items(app, &[&file, &edit, &window, &help]);
    }
    let app_menu = Submenu::with_items(
        app,
        name.as_str(),
        true,
        &[
            &about_item,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some(&t("nativeMenu.services")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&t("nativeMenu.hide")))?,
            &PredefinedMenuItem::hide_others(app, Some(&t("nativeMenu.hideOthers")))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        t("nativeMenu.view"),
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some(&t("nativeMenu.fullscreen")))?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

#[cfg(test)]
#[path = "../tests/unit/menu.rs"]
pub(crate) mod tests;
