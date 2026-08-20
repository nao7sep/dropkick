// Integration tests for the storage-root resolver.
//
// resolve_root is the pure half of data_root: it takes the home directory and
// the DROPKICK_HOME override as values, so every branch of the override grammar
// can be exercised without touching the real environment or an AppHandle.

use dropkick_lib::paths::resolve_root;
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
