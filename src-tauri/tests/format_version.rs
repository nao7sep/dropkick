// Every store's format version (store-recovery-conventions): the shared table,
// how a marker is judged, and the window-placement files the core owns.

use std::fs;

use dropkick_lib::format_version::{self, Format, Marker};
use dropkick_lib::window_placement::{
    file_text, load_file, NormalRectangle, Placement, SavedPlacement,
};
use rusqlite::Connection;
use serde_json::json;

#[test]
fn every_format_the_core_reads_is_in_the_shared_table_at_version_one() {
    for format in Format::ALL {
        assert_eq!(format.current(), 1, "{format:?}");
    }
}

#[test]
fn a_missing_marker_reads_as_one_and_a_newer_one_is_reported() {
    let format = Format::State;
    assert_eq!(
        format_version::json_value(&json!({}), format),
        Ok(Marker::Readable)
    );
    assert_eq!(
        format_version::json_value(&json!({ "formatVersion": 1 }), format),
        Ok(Marker::Readable)
    );
    assert_eq!(
        format_version::json_value(&json!({ "formatVersion": 2 }), format),
        Ok(Marker::Newer(2))
    );
    assert!(format_version::json_value(&json!({ "formatVersion": "2" }), format).is_err());
    assert!(format_version::json_value(&json!({ "formatVersion": 0 }), format).is_err());
    // Not an object: left to the reader's own shape check.
    assert_eq!(
        format_version::json_value(&json!([1]), format),
        Ok(Marker::Readable)
    );
    assert_eq!(
        format_version::json_bytes(b"{ not json", format),
        Ok(Marker::Readable)
    );
}

#[test]
fn a_sqlite_store_without_user_version_reads_as_one_and_is_stamped() {
    let conn = Connection::open_in_memory().unwrap();
    assert_eq!(
        format_version::sqlite(&conn, Format::Records),
        Ok(Marker::Readable)
    );
    format_version::stamp_sqlite(&conn, Format::Records).unwrap();
    let stamped: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(stamped, 1);
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
fn a_placement_file_without_a_marker_reads_as_version_one() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("window.json");
    fs::write(
        &path,
        r#"{"normal":{"x":10,"y":20,"width":800,"height":600},"maximized":false}"#,
    )
    .unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Found(placement())));
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
