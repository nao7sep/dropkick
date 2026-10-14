// Tests for the natively applied theme: which window theme a saved
// preferences document asks for, which document the startup picker previews,
// and that reading them never changes either file.

use std::fs;

use crate::theme::{
    preferences_window_theme, read_saved_window_theme,
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
        preferences_window_theme(&json!({ "theme": "light", "darkMode": true })),
        Some(Theme::Light)
    );
    assert_eq!(
        preferences_window_theme(&json!({ "theme": "system", "darkMode": true })),
        None
    );
}

#[test]
fn a_document_without_a_valid_theme_follows_the_os() {
    assert_eq!(
        preferences_window_theme(&json!({ "darkMode": true })),
        None
    );
    assert_eq!(
        preferences_window_theme(&json!({ "theme": "sepia", "darkMode": false })),
        None
    );
    assert_eq!(preferences_window_theme(&json!({})), None);
    assert_eq!(
        preferences_window_theme(&json!({ "darkMode": "yes" })),
        None
    );
}

#[test]
fn app_settings_take_precedence_over_legacy_selection() {
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join("state.json");
    let legacy = dir.path().join("preferences.json");
    let settings = dir.path().join("settings.json");
    fs::write(&legacy, r#"{"formatVersion":1,"theme":"dark"}"#).unwrap();
    fs::write(&state, json!({"formatVersion":1,"lastLaunchedPreferencesPath":legacy}).to_string()).unwrap();
    fs::write(&settings, r#"{"formatVersion":1,"theme":"light"}"#).unwrap();
    assert_eq!(read_saved_window_theme(&state), Some(Theme::Light));
    fs::write(&settings, r#"{"formatVersion":2,"theme":"dark"}"#).unwrap();
    assert_eq!(read_saved_window_theme(&state), None);
    fs::write(&settings, r#"{"formatVersion":1}"#).unwrap();
    assert_eq!(read_saved_window_theme(&state), None);
}

#[test]
fn reading_the_saved_theme_never_changes_either_file() {
    let dir = tempfile::tempdir().expect("temp dir");
    let state = dir.path().join("state.json");
    let preferences = dir.path().join("preferences.json");
    assert_eq!(read_saved_window_theme(&state), None);

    fs::write(&state, "{corrupt").expect("write state");
    assert_eq!(read_saved_window_theme(&state), None);
    assert_eq!(fs::read_to_string(&state).expect("read state"), "{corrupt");

    let state_body =
        json!({ "formatVersion": 1, "lastLaunchedPreferencesPath": preferences }).to_string();
    fs::write(&state, &state_body).expect("write state");
    assert_eq!(read_saved_window_theme(&state), None);

    let preferences_body = r#"{"formatVersion":1,"theme":"dark","name":"Work"}"#;
    fs::write(&preferences, preferences_body).expect("write preferences");
    assert_eq!(read_saved_window_theme(&state), Some(Theme::Dark));
    assert_eq!(fs::read_to_string(&state).expect("read state"), state_body);
    assert_eq!(
        fs::read_to_string(&preferences).expect("read preferences"),
        preferences_body
    );
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

#[test]
fn an_unmarked_or_newer_selected_file_is_not_previewed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let state = dir.path().join("state.json");
    let preferences = dir.path().join("external.json");
    fs::write(&preferences, r#"{"formatVersion":1,"theme":"dark"}"#).expect("write preferences");
    let state_body =
        json!({ "formatVersion": 1, "lastLaunchedPreferencesPath": preferences }).to_string();
    fs::write(&state, &state_body).expect("write state");
    assert_eq!(read_saved_window_theme(&state), Some(Theme::Dark));

    fs::write(&preferences, r#"{"theme":"dark"}"#).expect("write preferences");
    assert_eq!(read_saved_window_theme(&state), None);

    fs::write(&preferences, r#"{"formatVersion":2,"theme":"dark"}"#).expect("write preferences");
    assert_eq!(read_saved_window_theme(&state), None);

    fs::write(&preferences, r#"{"formatVersion":1,"theme":"dark"}"#).expect("write preferences");
    let unmarked_state = json!({ "lastLaunchedPreferencesPath": preferences }).to_string();
    fs::write(&state, &unmarked_state).expect("write state");
    assert_eq!(read_saved_window_theme(&state), None);

    fs::write(&preferences, r#"{"formatVersion":1,"theme":"dark"}"#).expect("write preferences");
    let newer_state = json!({ "formatVersion": 3, "lastLaunchedPreferencesPath": preferences }).to_string();
    fs::write(&state, &newer_state).expect("write state");
    assert_eq!(read_saved_window_theme(&state), None);
    assert_eq!(fs::read_to_string(&state).expect("read state"), newer_state);
}

// The OS appearance is read from the OS setting itself, so it answers on both
// supported platforms whatever theme a window is held to.
#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "macOS and Windows only: reads the OS appearance setting")]
fn system_theme_reads_the_os_appearance() {
    assert!(matches!(super::system_theme(), Some("light") | Some("dark")));
}
