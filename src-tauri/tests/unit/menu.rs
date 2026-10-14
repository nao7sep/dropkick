// Both platforms' native-menu layouts, checked on either host; building the
// menu itself needs a running app.
use super::{layout, Layout, KEYS};

#[test]
fn macos_keeps_quit_and_about_in_the_app_menu() {
    assert_eq!(
        layout(true),
        Layout {
            quit_key: "nativeMenu.quit",
            quit_accelerator: Some("CmdOrCtrl+Q"),
            quit_in_file: false,
            about_in_help: false,
            app_menu: true,
            maximize_key: "nativeMenu.zoom",
            window_separator: true,
        },
    );
}

#[test]
fn windows_keeps_exit_under_file_and_about_under_help() {
    assert_eq!(
        layout(false),
        Layout {
            quit_key: "nativeMenu.exit",
            quit_accelerator: None,
            quit_in_file: true,
            about_in_help: true,
            app_menu: false,
            maximize_key: "nativeMenu.maximize",
            window_separator: false,
        },
    );
}

#[test]
fn every_layout_reads_catalogue_keys_the_tests_check() {
    for macos in [true, false] {
        let layout = layout(macos);
        assert!(KEYS.contains(&layout.quit_key));
        assert!(KEYS.contains(&layout.maximize_key));
    }
}
