// Integration tests for the natively applied theme: which window theme a saved
// preferences document asks for, which document the startup picker previews,
// and that reading them never changes either file.

use std::fs;

use dropkick_lib::theme::{
    last_launched_preferences_path, preferences_window_theme, read_saved_window_theme,
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
fn a_valid_theme_wins_over_the_released_dark_mode_boolean() {
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
fn a_document_without_a_valid_theme_keeps_its_dark_mode_choice() {
    assert_eq!(
        preferences_window_theme(&json!({ "darkMode": true })),
        Some(Theme::Dark)
    );
    assert_eq!(
        preferences_window_theme(&json!({ "theme": "sepia", "darkMode": false })),
        Some(Theme::Light)
    );
    assert_eq!(preferences_window_theme(&json!({})), None);
    assert_eq!(
        preferences_window_theme(&json!({ "darkMode": "yes" })),
        None
    );
}

#[test]
fn the_previewed_document_falls_back_to_the_older_state_field() {
    assert_eq!(
        last_launched_preferences_path(&json!({
            "lastLaunchedPreferencesPath": "/a.json",
            "lastPreferencesPath": "/b.json"
        })),
        Some("/a.json")
    );
    assert_eq!(
        last_launched_preferences_path(&json!({ "lastPreferencesPath": "/b.json" })),
        Some("/b.json")
    );
    assert_eq!(
        last_launched_preferences_path(&json!({
            "lastLaunchedPreferencesPath": "",
            "lastPreferencesPath": "/b.json"
        })),
        None
    );
    assert_eq!(last_launched_preferences_path(&json!({})), None);
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

    let state_body = json!({ "lastLaunchedPreferencesPath": preferences }).to_string();
    fs::write(&state, &state_body).expect("write state");
    assert_eq!(read_saved_window_theme(&state), None);

    fs::write(&preferences, r#"{"theme":"dark","name":"Work"}"#).expect("write preferences");
    assert_eq!(read_saved_window_theme(&state), Some(Theme::Dark));
    assert_eq!(fs::read_to_string(&state).expect("read state"), state_body);
    assert_eq!(
        fs::read_to_string(&preferences).expect("read preferences"),
        r#"{"theme":"dark","name":"Work"}"#
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
