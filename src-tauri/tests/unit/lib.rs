use super::*;

// The commands are async; a test awaits each one to its real end.
fn settled<F: std::future::Future>(command: F) -> F::Output {
    tauri::async_runtime::block_on(command)
}

#[test]
fn quarantine_file_renames_and_preserves_bytes() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("state.json");
    std::fs::write(&path, b"{ corrupt bytes").unwrap();

    let quarantined = settled(quarantine_file(path.to_str().unwrap().to_string(), 1)).unwrap();

    assert!(!path.exists(), "source must be renamed away");
    assert_eq!(std::fs::read(&quarantined).unwrap(), b"{ corrupt bytes");
}

#[test]
fn quarantine_file_errors_for_missing_source() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("absent.json");
    assert!(settled(quarantine_file(path.to_str().unwrap().to_string(), 1)).is_err());
}

#[test]
#[cfg_attr(not(windows), ignore = "Windows only: holds the target open without FILE_SHARE_DELETE")]
fn quarantine_preserves_a_target_open_without_delete_sharing() {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        let original = b"{ corrupt bytes";
        std::fs::write(&path, original).unwrap();
        // Permit reading, but deny the delete/rename needed to quarantine it.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0x00000003)
            .open(&path).unwrap();
        assert!(settled(quarantine_file(path.to_str().unwrap().to_string(), 1)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no quarantine copy on failure");
        drop(held);
    }
}

#[test]
fn quarantine_refuses_a_newer_document_at_the_native_boundary() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let bytes = br#"{"formatVersion":2,"newState":"preserve"}"#;
    std::fs::write(&path, bytes).unwrap();
    assert!(settled(quarantine_file(path.to_str().unwrap().to_string(), 1)).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn read_json_returns_missing_for_absent_file() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("nope.json");
    let result = settled(read_json_file_with_hash(path.to_str().unwrap().to_string(), None)).unwrap();
    assert!(matches!(result, JsonFileWithHashResult::Missing));
}

#[test]
fn read_json_returns_invalid_for_bad_json() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("bad.json");
    std::fs::write(&path, b"{ not json").unwrap();
    let result = settled(read_json_file_with_hash(path.to_str().unwrap().to_string(), None)).unwrap();
    assert!(matches!(result, JsonFileWithHashResult::Invalid { .. }));
}

#[test]
fn read_json_returns_success_with_hash() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("good.json");
    let json = br#"{"formatVersion":1,"id":"L1","tasks":[]}"#;
    std::fs::write(&path, json).unwrap();
    let result = settled(read_json_file_with_hash(path.to_str().unwrap().to_string(), None)).unwrap();
    match result {
        JsonFileWithHashResult::Success { data, hash } => {
            assert!(data.tasks.is_empty());
            assert_eq!(hash, sha256_hex(json));
        }
        other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
    }
}

#[test]
fn read_text_file_returns_missing_success_states() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let missing = dir.join("nope.txt");
    assert!(matches!(
        settled(read_text_file(missing.to_str().unwrap().to_string())).unwrap(),
        TextReadResult::Missing
    ));

    let path = dir.join("f.txt");
    std::fs::write(&path, "héllo\nworld").unwrap();
    match settled(read_text_file(path.to_str().unwrap().to_string())).unwrap() {
        TextReadResult::Success { text } => assert_eq!(text, "héllo\nworld"),
        other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
    }
}

#[test]
fn file_exists_reflects_presence() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("f.txt");
    assert!(!settled(file_exists(path.to_string_lossy().into_owned())).unwrap());
    std::fs::write(&path, b"x").unwrap();
    assert!(settled(file_exists(path.to_string_lossy().into_owned())).unwrap());
}

#[test]
fn ensure_dir_creates_nested_and_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let nested = dir.join("a").join("b").join("c");
    let p = nested.to_str().unwrap();
    settled(ensure_dir(p.to_string())).unwrap();
    assert!(nested.is_dir());
    // Idempotent: calling again on an existing dir is fine.
    settled(ensure_dir(p.to_string())).unwrap();
}

#[test]
#[serial_test::serial(backup_store)]
fn volatile_state_uses_the_atomic_writer_without_recording_backup_history() {
    // Closes the store before the directory goes, even when an assertion fails.
    struct CloseStore;
    impl Drop for CloseStore {
        fn drop(&mut self) {
            backup_store::close_for_test();
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let history = dir.path().join("backups.sqlite3");
    backup_store::init(history.clone());
    let _close = CloseStore;
    let state = dir.path().join("state.json");
    let config = dir.path().join("config.json");
    let preferences = dir.path().join("preferences.json");

    let state_text = r#"{"zoomLevel":1.5}"#;
    let hash = settled(write_text_file_atomic(state.to_str().unwrap().to_string(), state_text.to_string(), Some(false))).unwrap();
    assert_eq!(hash, sha256_hex(state_text.as_bytes()));
    assert_eq!(std::fs::read_to_string(&state).unwrap(), state_text);
    settled(write_text_file_atomic(state.to_str().unwrap().to_string(), r#"{"zoomLevel":2}"#.to_string(), Some(false))).unwrap();
    settled(write_text_file_atomic(config.to_str().unwrap().to_string(), r#"{"knownWorkspaces":[]}"#.to_string(), None)).unwrap();
    settled(write_text_file_atomic(preferences.to_str().unwrap().to_string(), r#"{"id":"prefs","theme":"dark"}"#.to_string(), Some(true))).unwrap();

    backup_store::flush();
    let conn = rusqlite::Connection::open(history).unwrap();
    let rows = |path: &std::path::Path| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM backups WHERE path = ?1", [path.to_str().unwrap()], |row| row.get(0)).unwrap()
    };
    assert_eq!(rows(&state), 0);
    assert_eq!(rows(&config), 1);
    assert_eq!(rows(&preferences), 1);
}

#[test]
fn refresh_hash_match_skips_decoding_but_changed_bytes_still_require_admission() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("refresh.json");
    let path = path.to_str().unwrap().to_string();
    // Deliberately malformed bytes prove the equality path never decodes.
    // Production supplies only a digest previously admitted for this file.
    let bytes = b"not JSON";
    std::fs::write(&path, bytes).unwrap();
    let expected = sha256_hex(bytes);
    let result = settled(read_json_file_with_hash(path.clone(), Some(expected.clone()))).unwrap();
    assert_eq!(serde_json::to_value(result).unwrap(), json!({ "status": "unchanged" }));
    let changed = br#"{"formatVersion":1,"id":"changed","tasks":[]}"#;
    std::fs::write(&path, changed).unwrap();
    let result = settled(read_json_file_with_hash(path.clone(), Some(expected.clone()))).unwrap();
    assert!(matches!(result, JsonFileWithHashResult::Success { hash, .. } if hash == sha256_hex(changed)));
    std::fs::write(&path, br#"{"formatVersion":999}"#).unwrap();
    assert!(matches!(settled(read_json_file_with_hash(path.clone(), Some(expected.clone()))).unwrap(), JsonFileWithHashResult::Newer { .. }));
    std::fs::write(&path, b"different invalid bytes").unwrap();
    assert!(matches!(settled(read_json_file_with_hash(path.clone(), Some(expected.clone()))).unwrap(), JsonFileWithHashResult::Invalid { .. }));
    std::fs::remove_file(&path).unwrap();
    assert!(matches!(settled(read_json_file_with_hash(path, Some(expected))).unwrap(), JsonFileWithHashResult::Missing));
}

#[test]
fn native_save_failure_records_one_fact_and_returns_its_marker() {
    const NAME: &str = "tests::native_save_failure_records_one_fact_and_returns_its_marker";
    if std::env::var_os("DROPKICK_WRITE_FAILURE_FIXTURE").is_none() {
        let (status, output) = crate::process_fixture::run(NAME,
            &[("DROPKICK_WRITE_FAILURE_FIXTURE", "1")]);
        assert!(status.success(), "{output}");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let database = dir.path().join("records.sqlite3");
    logging::init(&database, &dir.path().join("logs"), false);
    let path = dir.path().join("absent-parent").join("document.json");
    let error = settled(write_text_file_atomic(path.to_string_lossy().into_owned(), "{}".into(), Some(false))).unwrap_err();
    let wire = serde_json::to_value(&error).unwrap();
    assert_eq!(wire["kind"], "recordedOperation");
    assert!(!wire["message"].as_str().unwrap().is_empty());
    logging::flush();
    let connection = rusqlite::Connection::open(database).unwrap();
    let failures: Vec<(String, String)> = connection.prepare("SELECT message, fields FROM logs WHERE level = 'error'").unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(failures.len(), 1);
    assert_eq!(failures[0].0, "file write failed");
    let fields: serde_json::Value = serde_json::from_str(&failures[0].1).unwrap();
    assert_eq!(fields["path"], path.to_string_lossy().as_ref());
    assert_eq!(fields["error"]["message"], wire["message"]);
    logging::shutdown();
}

#[test]
fn a_checked_write_publishes_only_over_the_expected_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let target = path.to_str().unwrap();
    let old = r#"{"formatVersion":1,"tasks":[]}"#;
    let new = r#"{"formatVersion":1,"tasks":[{"id":"new"}]}"#;
    std::fs::write(&path, old).unwrap();

    let refused = write_atomic_impl(target, new, false, Some("other")).unwrap();
    assert!(matches!(refused, CheckedWrite::Conflict));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), old);

    let saved = write_atomic_impl(target, new, false, Some(&sha256_hex(old.as_bytes()))).unwrap();
    assert!(matches!(saved, CheckedWrite::Saved { hash } if hash == sha256_hex(new.as_bytes())));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), new);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);

    std::fs::write(&path, r#"{"formatVersion":99}"#).unwrap();
    let newer = sha256_hex(br#"{"formatVersion":99}"#);
    assert!(write_atomic_impl(target, new, false, Some(&newer)).is_err());

    std::fs::remove_file(&path).unwrap();
    assert!(matches!(write_atomic_impl(target, new, false, Some(&newer)).unwrap(), CheckedWrite::Missing));
    assert!(!path.exists());
}
