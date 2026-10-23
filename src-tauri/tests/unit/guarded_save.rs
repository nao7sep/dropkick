use super::*;
const OLD: &str = r#"{"formatVersion":1,"tasks":[]}"#;
const NEW: &str = r#"{"formatVersion":1,"tasks":[{"id":"new"}]}"#;
const OUTSIDE: &str = r#"{"formatVersion":1,"tasks":[{"id":"outside"}]}"#;
fn fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    fs::write(&path, OLD).unwrap();
    (dir, path)
}
fn expected() -> Admission { Admission::Compare { hash: crate::sha256_hex(OLD.as_bytes()) } }

#[test]
fn comparison_missing_newer_and_unsupported_refuse_before_staging() {
    let (dir, path) = fixture();
    assert!(matches!(save(path.to_str().unwrap(), NEW, Admission::Compare { hash: "wrong".into() }), Outcome::Conflict));
    assert!(matches!(save_with(path.to_str().unwrap(), NEW, expected(), |_| false, |_,_| panic!("staged"), |_,_| {}), Outcome::Unsupported));
    assert_eq!(fs::read_to_string(&path).unwrap(), OLD);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    fs::write(&path, r#"{"formatVersion":99}"#).unwrap();
    assert!(matches!(save(path.to_str().unwrap(), NEW, Admission::Overwrite), Outcome::Failed { publication: Publication::Untouched, .. }));
    fs::remove_file(&path).unwrap();
    assert!(matches!(save(path.to_str().unwrap(), NEW, expected()), Outcome::Missing));
    assert!(matches!(save(path.to_str().unwrap(), NEW, Admission::Create), Outcome::Saved { .. }));
    assert!(matches!(save(path.to_str().unwrap(), OLD, Admission::Create), Outcome::Conflict));
    assert_eq!(fs::read_to_string(&path).unwrap(), NEW);
}
#[test]
fn identical_bytes_skip_staging_and_qualification() {
    let (_dir, path) = fixture();
    assert!(matches!(save_with(path.to_str().unwrap(), OLD, expected(), |_| panic!("qualification"), |_,_| panic!("staging"), |_,_| {}), Outcome::Saved { .. }));
}
#[test]
fn late_recheck_refuses_changes_and_newer_formats_without_publication() {
    for external in [OUTSIDE, r#"{"formatVersion":99}"#] {
        let (dir, path) = fixture();
        let result = save_with(path.to_str().unwrap(), NEW, expected(), |_| true,
            |path,_| fs::write(path, external).unwrap(), |_,_| panic!("published"));
        assert!(matches!(result, Outcome::Conflict | Outcome::Failed { publication: Publication::Untouched, .. }));
        assert_eq!(fs::read_to_string(path).unwrap(), external);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "native displacement primitive")]
fn competing_rename_preserves_exact_displaced_bytes_and_published_outcome() {
    let (dir, path) = fixture();
    let result = save_with(path.to_str().unwrap(), NEW, expected(), |_| true, |_,_| {}, |target,_| {
        let external = dir.path().join("outside");
        fs::write(&external, OUTSIDE).unwrap();
        crate::replace_target(&external, target).unwrap();
    });
    let Outcome::Saved { hash, recovery_path: Some(recovery) } = result else { panic!("{result:?}"); };
    assert_eq!(hash, crate::sha256_hex(NEW.as_bytes()));
    assert_eq!(fs::read_to_string(&path).unwrap(), NEW);
    assert_eq!(fs::read_to_string(recovery).unwrap(), OUTSIDE);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}
#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "native displacement primitive")]
fn in_place_change_before_exchange_is_retained_and_unchanged_displacement_is_removed() {
    for changed in [true, false] {
        let (dir, path) = fixture();
        let result = save_with(path.to_str().unwrap(), NEW, expected(), |_| true, |_,_| {}, |target,_| {
            if changed { fs::write(target, OUTSIDE).unwrap(); }
        });
        let Outcome::Saved { recovery_path, .. } = result else { panic!("{result:?}"); };
        assert_eq!(recovery_path.is_some(), changed);
        if let Some(path) = recovery_path { assert_eq!(fs::read_to_string(path).unwrap(), OUTSIDE); }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), if changed { 2 } else { 1 });
    }
}
#[test]
fn partial_windows_outcomes_never_authorize_compensation() {
    assert_eq!(windows_failure(Some(1175)), Publication::Untouched);
    assert_eq!(windows_failure(Some(1176)), Publication::Untouched);
    for code in [Some(1177), Some(5), None] { assert_eq!(windows_failure(code), Publication::Unknown); }
}
#[test]
#[cfg_attr(not(target_os = "macos"), ignore = "local APFS qualification")]
fn local_fixture_volume_is_qualified() {
    let (dir, _) = fixture();
    assert!(qualified(dir.path()));
}

#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "native displacement primitive")]
fn initial_facts_share_one_read_and_changed_bytes_require_only_freshness_and_displacement_reads() {
    let (_dir, path) = fixture();
    READS.with(|count| count.set(0));
    assert!(matches!(save_with(path.to_str().unwrap(), OLD, expected(), |_| true, |_,_| {}, |_,_| {}), Outcome::Saved { .. }));
    assert_eq!(READS.with(|count| count.get()), 1);
    READS.with(|count| count.set(0));
    assert!(matches!(save_with(path.to_str().unwrap(), NEW, expected(), |_| true, |_,_| {}, |_,_| {}), Outcome::Saved { .. }));
    assert_eq!(READS.with(|count| count.get()), 3);
}

#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "native displacement primitive")]
fn interrupted_post_exchange_cleanup_keeps_both_complete_copies() {
    let (dir, target) = fixture();
    let directory = dir.path().join("interrupted.tmp");
    fs::create_dir(&directory).unwrap();
    let staged = directory.join("tasks.json");
    fs::write(&staged, NEW).unwrap();
    let displaced = exchange(&staged, &target).unwrap();
    // The same guard dropped by unwinding after publication must not delete
    // the displaced version. Abrupt process termination runs no cleanup either.
    drop(Stage { directory: directory.clone(), file: staged, disposable: false });
    assert_eq!(fs::read_to_string(&target).unwrap(), NEW);
    assert_eq!(fs::read_to_string(displaced).unwrap(), OLD);
    assert!(directory.exists());
}

#[test]
#[cfg_attr(not(any(target_os = "macos", windows)), ignore = "native displacement primitive")]
fn an_open_external_handle_can_keep_changing_the_preserved_inode_but_not_the_published_file() {
    use std::io::{Seek, SeekFrom};
    let (_dir, path) = fixture();
    let mut external = fs::OpenOptions::new().write(true).open(&path).unwrap();
    let result = save_with(path.to_str().unwrap(), NEW, expected(), |_| true, |_,_| {}, |_,_| {
        external.set_len(0).unwrap();
        external.write_all(OUTSIDE.as_bytes()).unwrap();
        external.sync_all().unwrap();
    });
    let Outcome::Saved { recovery_path: Some(recovery), .. } = result else { panic!("{result:?}"); };
    external.seek(SeekFrom::Start(0)).unwrap();
    external.set_len(0).unwrap();
    external.write_all(b"later in-place bytes").unwrap();
    external.sync_all().unwrap();
    assert_eq!(fs::read_to_string(path).unwrap(), NEW);
    assert_eq!(fs::read_to_string(recovery).unwrap(), "later in-place bytes");
}
