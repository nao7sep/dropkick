// Integration tests for the storage-root resolver.
//
// resolve_root is the pure half of data_root: it takes the home directory and
// the DROPKICK_HOME override as values, so every branch of the override grammar
// can be exercised without touching the real environment or an AppHandle.

use dropkick_lib::paths::{app_paths, resolve_root};
#[cfg(unix)]
use dropkick_lib::paths::{create_storage_root, secure_root};
use std::path::PathBuf;

#[test]
fn default_root_is_home_dot_dropkick() {
    let home = PathBuf::from("/home/tester");
    // Unset / empty / whitespace all fall back to the default root.
    assert_eq!(resolve_root(&home, None).unwrap(), home.join(".dropkick"));
    assert_eq!(
        resolve_root(&home, Some(String::new())).unwrap(),
        home.join(".dropkick")
    );
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

#[test]
fn native_window_state_has_its_own_file_name() {
    assert_eq!(dropkick_lib::paths::WINDOW_FILE_NAME, "window.json");
}

// Storage-path-conventions: the root is owner-only (0700) on POSIX — created
// that way, and tightened to 0700 at each launch when an existing root is
// broader. Both cases are exercised here against a throwaway home directory,
// driving the same `secure_root` step `data_root` runs on every launch.
#[cfg(unix)]
#[test]
fn new_root_is_created_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("dropkick-home"); // acts as a throwaway DROPKICK_HOME
    std::fs::create_dir_all(&root).unwrap();

    secure_root(&root).unwrap();

    let mode = std::fs::metadata(&root).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}

// A freshly created root must be born owner-only, not merely tightened
// afterward — otherwise a broad umask (e.g. 022) leaves it briefly
// world-readable between creation and the `secure_root` tightening step.
#[cfg(unix)]
#[test]
fn create_storage_root_creates_a_fresh_root_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("dropkick-home").join(".dropkick");

    create_storage_root(&root).unwrap();

    let mode = std::fs::metadata(&root).unwrap().permissions().mode() & 0o777;
    assert_eq!(
        mode, 0o700,
        "the storage root must be created owner-only, not just tightened after the fact"
    );
}

#[cfg(unix)]
#[test]
fn existing_broader_root_is_tightened_on_launch() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("dropkick-home"); // acts as a throwaway DROPKICK_HOME
    std::fs::create_dir_all(&root).unwrap();
    // Simulate a pre-existing root that is broader than owner-only, e.g. left
    // over from before this rule, or created with a permissive umask.
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(std::fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o755);

    secure_root(&root).unwrap();

    let mode = std::fs::metadata(&root).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}
