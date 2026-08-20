// Integration tests for the storage-root resolver.
//
// resolve_root is the pure half of data_root: it takes the home directory and
// the DROPKICK_HOME override as values, so every branch of the override grammar
// can be exercised without touching the real environment or an AppHandle.

use dropkick_lib::paths::{app_paths, resolve_root};
use std::path::PathBuf;


#[test]
fn default_root_is_home_dot_dropkick() {
    let home = PathBuf::from("/home/tester");
    // Unset / empty / whitespace all fall back to the default root.
    assert_eq!(resolve_root(&home, None).unwrap(), home.join(".dropkick"));
    assert_eq!(resolve_root(&home, Some(String::new())).unwrap(), home.join(".dropkick"));
    assert_eq!(
        resolve_root(&home, Some("   ".to_string())).unwrap(),
        home.join(".dropkick")
    );
}

#[test]
fn env_var_relocates_root_to_absolute_path() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(
        resolve_root(&home, Some("/tmp/dk-test".to_string())).unwrap(),
        PathBuf::from("/tmp/dk-test")
    );
}

#[test]
fn env_var_expands_leading_tilde() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(resolve_root(&home, Some("~".to_string())).unwrap(), home);
    assert_eq!(
        resolve_root(&home, Some("~/profiles/work".to_string())).unwrap(),
        home.join("profiles/work")
    );
}

#[test]
fn relative_env_var_resolves_against_home_not_cwd() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(
        resolve_root(&home, Some("alt-root".to_string())).unwrap(),
        home.join("alt-root")
    );
}

#[test]
fn expands_environment_references_in_the_override() {
    let home = PathBuf::from("/home/tester");
    std::env::set_var("DROPKICK_TEST_BASE", "/mnt/disk2");
    assert_eq!(
        resolve_root(&home, Some("$DROPKICK_TEST_BASE/dk".to_string())).unwrap(),
        PathBuf::from("/mnt/disk2/dk")
    );
    assert_eq!(
        resolve_root(&home, Some("${DROPKICK_TEST_BASE}/dk".to_string())).unwrap(),
        PathBuf::from("/mnt/disk2/dk")
    );
    std::env::remove_var("DROPKICK_TEST_BASE");
}

#[test]
fn override_that_expands_to_empty_is_rejected() {
    let home = PathBuf::from("/home/tester");
    std::env::remove_var("DROPKICK_UNSET_FOR_TEST");
    assert!(resolve_root(&home, Some("$DROPKICK_UNSET_FOR_TEST".to_string())).is_err());
}

// The storage layout: every standard subpath resolved in one place, so the
// webview never composes a data path of its own and adding or renaming a store
// means editing one file rather than finding five.
#[test]
fn app_paths_puts_every_standard_subpath_under_the_root() {
    let root = PathBuf::from("/home/tester/.dropkick");
    let layout = app_paths(&root);

    assert_eq!(layout.root, root.to_string_lossy());
    for path in [
        &layout.state_file,
        &layout.preferences_file,
        &layout.workspace_file,
        &layout.note_drafts_file,
        &layout.logs_dir,
        &layout.backups_file,
    ] {
        assert!(
            std::path::Path::new(path).starts_with(&root),
            "{path} escaped the storage root"
        );
    }
}

#[test]
fn app_paths_names_each_store_distinctly() {
    let layout = app_paths(&PathBuf::from("/r"));
    let names = [
        layout.state_file.clone(),
        layout.preferences_file.clone(),
        layout.workspace_file.clone(),
        layout.note_drafts_file.clone(),
        layout.logs_dir.clone(),
        layout.backups_file.clone(),
    ];
    let unique: std::collections::HashSet<&String> = names.iter().collect();
    assert_eq!(unique.len(), names.len(), "two stores share a path");
}
