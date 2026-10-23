// Every store's format version (store-recovery-conventions): the shared table,
// how a marker is judged, and the window-placement files the core owns.

use std::fs;

use crate::format_version::{self, Format, Marker};
use crate::window_placement::{
    file_text, load_file, NormalRectangle, Placement, SavedPlacement,
};
use rusqlite::Connection;
use serde_json::json;

#[test]
fn every_format_the_core_reads_is_in_the_shared_table() {
    for format in Format::ALL {
        // Backup history and view state have advanced independently.
        let expected = if matches!(format, Format::Backups | Format::State) { 2 } else { 1 };
        assert_eq!(format.current(), expected, "{format:?}");
    }
}

#[test]
fn genuine_creation_initializes_schema_and_marker_but_existing_empty_or_negative_stores_are_preserved(
) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new.sqlite3");
    let conn =
        format_version::open_sqlite(&path, Format::Records, "CREATE TABLE logs (id INTEGER);")
            .unwrap();
    assert_eq!(
        format_version::sqlite(&conn, Format::Records),
        Ok(Marker::Readable)
    );
    assert!(conn.prepare("SELECT * FROM logs").is_ok());
    drop(conn);
    for negative in [false, true] {
        let path = dir.path().join(if negative {
            "negative.sqlite3"
        } else {
            "empty.sqlite3"
        });
        let conn = Connection::open(&path).unwrap();
        if negative {
            conn.pragma_update(None, "user_version", -1).unwrap();
        }
        drop(conn);
        let before = fs::read(&path).unwrap();
        assert!(format_version::open_sqlite(
            &path,
            Format::Records,
            "CREATE TABLE logs (id INTEGER);"
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

#[test]
fn failed_new_schema_initialization_leaves_no_marker_or_partial_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("failed.sqlite3");
    assert!(format_version::open_sqlite(
        &path,
        Format::Records,
        "CREATE TABLE logs (id INTEGER); INVALID SQL;"
    )
    .is_err());
    assert!(!path.exists());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn sqlite_is_complete_before_publication_and_preserves_unowned_stages() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("records.sqlite3");
    let stranded = dir.path().join("records-stranded.tmp");
    fs::create_dir(&stranded).unwrap();
    fs::write(stranded.join("unknown"), b"preserve").unwrap();
    let conn = format_version::open_sqlite_with_publish(
        &path,
        Format::Records,
        "CREATE TABLE logs (id INTEGER); INSERT INTO logs VALUES (42);",
        |staged, target| {
            assert!(!target.exists(), "no partial store at the final pathname");
            assert_eq!(staged.file_name(), target.file_name());
            assert_eq!(fs::read_dir(staged.parent().unwrap()).unwrap().count(), 1);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(staged.parent().unwrap())
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o700
                );
            }
            let staged_conn =
                Connection::open_with_flags(staged, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .unwrap();
            assert_eq!(
                format_version::sqlite(&staged_conn, Format::Records),
                Ok(Marker::Readable)
            );
            assert_eq!(
                staged_conn
                    .query_row("SELECT id FROM logs", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                42
            );
            assert_eq!(
                staged_conn
                    .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "delete"
            );
            assert_eq!(
                staged_conn
                    .query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "ok"
            );
            staged_conn.close().unwrap();
            crate::publish_new(staged, target)
        },
    )
    .unwrap();
    conn.close().unwrap();
    assert_eq!(fs::read(stranded.join("unknown")).unwrap(), b"preserve");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
fn competing_sqlite_creation_never_clobbers_the_winning_store() {
    for marker in [0, 1, 2] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("records.sqlite3");
        let mut winner_bytes = Vec::new();
        let result = format_version::open_sqlite_with_publish(
            &path,
            Format::Records,
            "CREATE TABLE losing_schema (id INTEGER);",
            |staged, target| {
                let winner = Connection::open(target).unwrap();
                winner
                    .execute_batch("CREATE TABLE winning_schema (id INTEGER);")
                    .unwrap();
                winner.pragma_update(None, "user_version", marker).unwrap();
                winner.close().unwrap();
                winner_bytes = fs::read(target).unwrap();
                crate::publish_new(staged, target)
            },
        );
        if marker == 1 {
            let conn = result.unwrap();
            assert!(conn.prepare("SELECT * FROM winning_schema").is_ok());
            assert!(conn.prepare("SELECT * FROM losing_schema").is_err());
            conn.close().unwrap();
        } else {
            assert!(result.is_err());
        }
        assert_eq!(fs::read(&path).unwrap(), winner_bytes);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

#[test]
fn existing_readable_and_newer_sqlite_stores_keep_their_bytes_and_markers() {
    for marker in [1, 3] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.sqlite3");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE original (id INTEGER);")
            .unwrap();
        conn.pragma_update(None, "user_version", marker).unwrap();
        conn.close().unwrap();
        let before = fs::read(&path).unwrap();
        let result = format_version::open_sqlite(&path, Format::State, "INVALID SQL;");
        if marker == 1 {
            result.unwrap().close().unwrap();
        } else {
            assert!(result.unwrap_err().contains("newer than this build"));
        }
        assert_eq!(fs::read(&path).unwrap(), before);
    }
}

#[test]
fn cached_mutation_admission_refuses_a_newer_marker() {
    let conn = Connection::open_in_memory().unwrap();
    format_version::stamp_sqlite(&conn, Format::Records).unwrap();
    format_version::admit_sqlite(&conn, Format::Records).unwrap();
    conn.pragma_update(None, "user_version", 2).unwrap();
    let tx = rusqlite::Transaction::new_unchecked(&conn, rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    assert!(format_version::admit_sqlite(&tx, Format::Records).is_err());
}

#[test]
fn a_missing_marker_is_unreadable_and_a_newer_one_is_reported() {
    let format = Format::State;
    assert!(format_version::json_value(&json!({}), format).is_err());
    assert!(format_version::json_value(&json!({ "version": "1.0.1" }), format).is_err());
    assert!(format_version::json_value(&json!({ "version": 1 }), format).is_err());
    // v0.1.0's label stands in for version 1; a real marker beside it wins.
    assert_eq!(
        format_version::json_value(&json!({ "version": "1.0.0" }), format),
        Ok(Marker::Readable)
    );
    assert_eq!(
        format_version::json_value(&json!({ "version": "1.0.0", "formatVersion": 3 }), format),
        Ok(Marker::Newer(3))
    );
    assert!(format_version::json_value(&json!([1]), format).is_err());
    assert!(format_version::json_bytes(b"{ not json", format).is_err());
    assert!(format_version::json_bytes(br#"{"formatVersion":null}"#, format).is_err());
    assert!(format_version::json_value(&json!({ "formatVersion": "2" }), format).is_err());
    assert!(format_version::json_value(&json!({ "formatVersion": 0 }), format).is_err());
    assert_eq!(
        format_version::json_value(&json!({ "formatVersion": 1 }), format),
        Ok(Marker::Readable)
    );
    assert_eq!(
        format_version::json_value(&json!({ "formatVersion": 3 }), format),
        Ok(Marker::Newer(3))
    );
}

#[test]
fn a_new_sqlite_store_is_stamped_and_an_existing_one_without_user_version_is_unreadable() {
    let conn = Connection::open_in_memory().unwrap();
    assert!(format_version::sqlite(&conn, Format::Records).is_err());
    conn.execute_batch("CREATE TABLE logs (id INTEGER PRIMARY KEY);")
        .unwrap();
    assert!(format_version::sqlite(&conn, Format::Records).is_err());
    format_version::stamp_sqlite(&conn, Format::Records).unwrap();
    assert_eq!(
        format_version::sqlite(&conn, Format::Records),
        Ok(Marker::Readable)
    );
    conn.pragma_update(None, "user_version", 2).unwrap();
    assert_eq!(
        format_version::sqlite(&conn, Format::Records),
        Ok(Marker::Newer(2))
    );
}

fn placement() -> Placement {
    Placement {
        normal: NormalRectangle {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        },
        maximized: false,
    }
}

#[test]
fn a_placement_file_without_a_marker_is_set_aside() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("window.json");
    let text = r#"{"normal":{"x":10,"y":20,"width":800,"height":600},"maximized":false}"#;
    fs::write(&path, text).unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Absent));
    assert!(!path.exists());
    let set_aside = fs::read_dir(dir.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(set_aside.to_string_lossy().ends_with(".invalid"));
    assert_eq!(fs::read_to_string(set_aside).unwrap(), text);
}

#[test]
fn a_placement_file_round_trips_with_its_format_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("window.json");
    let text = file_text(placement()).unwrap();
    let written: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(written["formatVersion"], json!(1));
    fs::write(&path, &text).unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Found(placement())));
}

#[test]
fn a_newer_placement_file_is_left_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("records-window.json");
    let text = r#"{"formatVersion":2,"bounds":[1,2,3,4]}"#;
    fs::write(&path, text).unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Newer(2)));
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "nothing quarantined"
    );
}
