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
        // The backup history gained sessions in format 2; the rest are at 1.
        let expected = if format == Format::Backups { 2 } else { 1 };
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
        format_version::json_value(&json!({ "version": "1.0.0", "formatVersion": 2 }), format),
        Ok(Marker::Newer(2))
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
        format_version::json_value(&json!({ "formatVersion": 2 }), format),
        Ok(Marker::Newer(2))
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
