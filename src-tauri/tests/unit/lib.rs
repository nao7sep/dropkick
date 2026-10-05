use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

// Unique temp directory per call so parallel tests never collide.
fn unique_temp_dir(label: &str) -> std::path::PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "dropkick-test-{}-{}-{}",
        label,
        std::process::id(),
        n
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn hash_file_hashes_actual_bytes() {
    let dir = unique_temp_dir("hash");
    let path = dir.join("f.txt");
    std::fs::write(&path, b"abc").unwrap();
    let result = hash_file(path.to_str().unwrap()).unwrap();
    assert_eq!(result, Some(sha256_hex(b"abc")));
}

#[test]
fn hash_file_returns_missing_for_an_absent_file() {
    let dir = unique_temp_dir("hash-missing");
    let path = dir.join("absent.txt");
    assert_eq!(hash_file(path.to_str().unwrap()).unwrap(), None);
}

#[test]
fn quarantine_file_renames_and_preserves_bytes() {
    let dir = unique_temp_dir("quarantine");
    let path = dir.join("state.json");
    std::fs::write(&path, b"{ corrupt bytes").unwrap();

    let quarantined = quarantine_file(path.to_str().unwrap()).unwrap();

    assert!(!path.exists(), "source must be renamed away");
    assert_eq!(std::fs::read(&quarantined).unwrap(), b"{ corrupt bytes");
}

#[test]
fn quarantine_file_errors_for_missing_source() {
    let dir = unique_temp_dir("quarantine-missing");
    let path = dir.join("absent.json");
    assert!(quarantine_file(path.to_str().unwrap()).is_err());
}

#[test]
fn read_json_returns_missing_for_absent_file() {
    let dir = unique_temp_dir("read-missing");
    let path = dir.join("nope.json");
    let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
    assert!(matches!(result, JsonFileWithHashResult::Missing));
}

#[test]
fn read_json_returns_invalid_for_bad_json() {
    let dir = unique_temp_dir("read-invalid");
    let path = dir.join("bad.json");
    std::fs::write(&path, b"{ not json").unwrap();
    let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
    assert!(matches!(result, JsonFileWithHashResult::Invalid { .. }));
}

#[test]
fn read_json_returns_success_with_hash() {
    let dir = unique_temp_dir("read-success");
    let path = dir.join("good.json");
    let json = br#"{"formatVersion":1,"id":"L1","tasks":[]}"#;
    std::fs::write(&path, json).unwrap();
    let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
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
    let dir = unique_temp_dir("read-text");
    let missing = dir.join("nope.txt");
    assert!(matches!(
        read_text_file(missing.to_str().unwrap()).unwrap(),
        TextReadResult::Missing
    ));

    let path = dir.join("f.txt");
    std::fs::write(&path, "héllo\nworld").unwrap();
    match read_text_file(path.to_str().unwrap()).unwrap() {
        TextReadResult::Success { text } => assert_eq!(text, "héllo\nworld"),
        other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
    }
}

#[test]
fn file_exists_reflects_presence() {
    let dir = unique_temp_dir("exists");
    let path = dir.join("f.txt");
    assert!(!file_exists(path.to_string_lossy().into_owned()));
    std::fs::write(&path, b"x").unwrap();
    assert!(file_exists(path.to_string_lossy().into_owned()));
}

#[test]
fn ensure_dir_creates_nested_and_is_idempotent() {
    let dir = unique_temp_dir("ensure");
    let nested = dir.join("a").join("b").join("c");
    let p = nested.to_str().unwrap();
    ensure_dir(p).unwrap();
    assert!(nested.is_dir());
    // Idempotent: calling again on an existing dir is fine.
    ensure_dir(p).unwrap();
}

#[test]
#[serial_test::serial(backup_store)]
fn volatile_state_uses_the_atomic_writer_without_recording_backup_history() {
    let dir = tempfile::tempdir().unwrap();
    let history = dir.path().join("backups.sqlite3");
    backup_store::init(history.clone());
    let state = dir.path().join("state.json");
    let config = dir.path().join("config.json");
    let preferences = dir.path().join("preferences.json");

    let state_text = r#"{"zoomLevel":1.5}"#;
    let hash = write_text_file_atomic(state.to_str().unwrap(), state_text, Some(false)).unwrap();
    assert_eq!(hash, sha256_hex(state_text.as_bytes()));
    assert_eq!(std::fs::read_to_string(&state).unwrap(), state_text);
    write_text_file_atomic(state.to_str().unwrap(), r#"{"zoomLevel":2}"#, Some(false)).unwrap();
    write_text_file_atomic(config.to_str().unwrap(), r#"{"knownWorkspaces":[]}"#, None).unwrap();
    write_text_file_atomic(preferences.to_str().unwrap(), r#"{"id":"prefs","theme":"dark"}"#, Some(true)).unwrap();

    let conn = rusqlite::Connection::open(history).unwrap();
    let rows = |path: &std::path::Path| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM backups WHERE path = ?1", [path.to_str().unwrap()], |row| row.get(0)).unwrap()
    };
    assert_eq!(rows(&state), 0);
    assert_eq!(rows(&config), 1);
    assert_eq!(rows(&preferences), 1);
    backup_store::close_for_test();
}
