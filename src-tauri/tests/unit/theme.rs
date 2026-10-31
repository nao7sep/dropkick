// Tests for the natively applied theme: which window theme the saved settings
// ask for, when the settings are previewed, and that reading them never
// changes a file.

use std::fs;

use crate::theme::{
    settings_window_theme, read_appearance,
    window_background, window_theme_for,
};
use serde_json::json;
use tauri::window::Color;
use tauri::Theme;

#[test]
fn explicit_light_and_dark_pin_the_window_theme() {
    assert_eq!(window_theme_for("light"), Some(Theme::Light));
    assert_eq!(window_theme_for("dark"), Some(Theme::Dark));
    for preference in ["system", "", "Dark", "sepia"] {
        assert_eq!(window_theme_for(preference), None, "{preference}");
    }
}

#[test]
fn a_valid_theme_ignores_unknown_keys() {
    assert_eq!(
        settings_window_theme(&json!({ "theme": "light", "darkMode": true })),
        Some(Theme::Light)
    );
    assert_eq!(
        settings_window_theme(&json!({ "theme": "system", "darkMode": true })),
        None
    );
}

#[test]
fn a_document_without_a_valid_theme_follows_the_os() {
    assert_eq!(
        settings_window_theme(&json!({ "darkMode": true })),
        None
    );
    assert_eq!(
        settings_window_theme(&json!({ "theme": "sepia", "darkMode": false })),
        None
    );
    assert_eq!(settings_window_theme(&json!({})), None);
    assert_eq!(
        settings_window_theme(&json!({ "darkMode": "yes" })),
        None
    );
}

#[test]
fn the_settings_theme_is_previewed_only_when_marked_and_readable() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("state.json");
    let settings = dir.path().join("settings.json");
    assert_eq!(read_appearance(&state).theme, None);
    fs::write(&settings, r#"{"format":{"owner":"dropkick","kind":"settings","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"theme":"light"}"#).unwrap();
    assert_eq!(read_appearance(&state).theme, Some(Theme::Light));
    fs::write(&settings, r#"{"theme":"dark"}"#).unwrap();
    assert_eq!(read_appearance(&state).theme, None);
    fs::write(&settings, r#"{"format":{"owner":"dropkick","kind":"settings","version":2},"writer":{"name":"dropkick","version":"1.0.0"},"theme":"dark"}"#).unwrap();
    assert_eq!(read_appearance(&state).theme, None);
    fs::write(&settings, r#"{"format":{"owner":"dropkick","kind":"settings","version":1},"writer":{"name":"dropkick","version":"1.0.0"}}"#).unwrap();
    assert_eq!(read_appearance(&state).theme, None);
}

#[test]
fn reading_the_saved_theme_never_changes_either_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let state = dir.path().join("state.json");
    let settings = dir.path().join("settings.json");
    fs::write(&state, "{corrupt").expect("write state");
    assert_eq!(read_appearance(&state).theme, None);

    let settings_body = r#"{"format":{"owner":"dropkick","kind":"settings","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"theme":"dark"}"#;
    fs::write(&settings, settings_body).expect("write settings");
    assert_eq!(read_appearance(&state).theme, Some(Theme::Dark));
    assert_eq!(fs::read_to_string(&state).expect("read state"), "{corrupt");
    assert_eq!(fs::read_to_string(&settings).expect("read settings"), settings_body);
}

#[test]
fn each_theme_has_its_own_window_background() {
    assert_eq!(
        window_background(Theme::Dark),
        Color(0x17, 0x17, 0x17, 0xff)
    );
    assert_eq!(
        window_background(Theme::Light),
        Color(0xf9, 0xfa, 0xfb, 0xff)
    );
}

// The OS appearance is read from the OS setting itself, so it answers on both
// supported platforms whatever theme a window is held to.
#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "macOS and Windows only: reads the OS appearance setting")]
fn system_theme_reads_the_os_appearance() {
    assert!(matches!(super::system_theme(), Some("light") | Some("dark")));
}

#[test]
fn one_immutable_appearance_snapshot_takes_language_and_theme_from_the_settings() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("state.json");
    let settings = dir.path().join("settings.json");
    fs::write(&settings, r#"{"format":{"owner":"dropkick","kind":"settings","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"language":"de","theme":"light"}"#).unwrap();
    let snapshot = read_appearance(&state);
    fs::write(&settings, r#"{"format":{"owner":"dropkick","kind":"settings","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"language":"ja","theme":"dark"}"#).unwrap();
    assert_eq!((snapshot.language, snapshot.theme), (Some("de"), Some(Theme::Light)));
    let changed = read_appearance(&state);
    assert_eq!((changed.language, changed.theme), (Some("ja"), Some(Theme::Dark)));
}
