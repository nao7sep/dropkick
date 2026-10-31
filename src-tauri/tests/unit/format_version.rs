// The file identity header (file-identity-conventions): the shared table, how
// a header is judged, and the window-placement files the core owns.

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
        assert_eq!(format.current(), 1, "{format:?}");
    }
}

#[test]
fn creation_and_an_empty_unmarked_store_are_initialized_but_a_negative_marker_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["new.sqlite3", "empty.sqlite3"] {
        let path = dir.path().join(name);
        if name == "empty.sqlite3" {
            drop(Connection::open(&path).unwrap());
        }
        let conn =
            format_version::open_sqlite(&path, Format::Records, "CREATE TABLE logs (id INTEGER);")
                .unwrap();
        assert_eq!(format_version::sqlite(&conn, Format::Records), Ok(Marker::Readable));
        assert!(conn.prepare("SELECT * FROM logs").is_ok());
    }
    let path = dir.path().join("negative.sqlite3");
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", -1).unwrap();
    drop(conn);
    let before = fs::read(&path).unwrap();
    assert!(format_version::open_sqlite(&path, Format::Records, "CREATE TABLE logs (id INTEGER);").is_err());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn failed_schema_initialization_leaves_no_marker_and_a_later_launch_creates_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("failed.sqlite3");
    assert!(format_version::open_sqlite(
        &path,
        Format::Records,
        "CREATE TABLE logs (id INTEGER); INVALID SQL;"
    )
    .is_err());
    let conn = format_version::open_sqlite(&path, Format::Records, "CREATE TABLE logs (id INTEGER);").unwrap();
    assert_eq!(format_version::sqlite(&conn, Format::Records), Ok(Marker::Readable));
    assert!(conn.prepare("SELECT * FROM logs").is_ok());
}

// A store as an earlier launch left it: its own table, and file_header rows
// naming `owner` and `kind` unless `owner` is None.
fn existing_store(path: &std::path::Path, version: i64, owner: Option<&str>, kind: &str) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch("CREATE TABLE original (id INTEGER);").unwrap();
    if let Some(owner) = owner {
        conn.execute_batch("CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        for (key, value) in [
            ("format.owner", owner),
            ("format.kind", kind),
            ("writer.name", "dropkick"),
            ("writer.version", "0.0.1"),
        ] {
            conn.execute("INSERT INTO file_header VALUES (?1, ?2)", [key, value]).unwrap();
        }
    }
    conn.pragma_update(None, "user_version", version).unwrap();
    conn.close().unwrap();
}

fn header_rows(conn: &Connection) -> Vec<(String, String)> {
    conn.prepare("SELECT key, value FROM file_header ORDER BY key")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn a_new_sqlite_store_gets_its_header_table() {
    let dir = tempfile::tempdir().unwrap();
    let conn = format_version::open_sqlite(&dir.path().join("new.sqlite3"), Format::Backups, "CREATE TABLE b (id INTEGER);")
        .unwrap();
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, 1);
    assert_eq!(
        header_rows(&conn),
        [
            ("format.kind".to_string(), "backups".to_string()),
            ("format.owner".to_string(), "dropkick".to_string()),
            ("writer.name".to_string(), "dropkick".to_string()),
            ("writer.version".to_string(), env!("CARGO_PKG_VERSION").to_string()),
        ]
    );
}

#[test]
fn a_readable_sqlite_store_is_opened_and_its_writer_rows_rewritten() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.sqlite3");
    existing_store(&path, 1, Some("dropkick"), "records");
    let conn = format_version::open_sqlite(&path, Format::Records, "INVALID SQL;").unwrap();
    assert!(conn.prepare("SELECT * FROM original").is_ok());
    let rows = header_rows(&conn);
    assert!(rows.contains(&("writer.version".to_string(), env!("CARGO_PKG_VERSION").to_string())));
    assert!(rows.contains(&("format.kind".to_string(), "records".to_string())));
}

#[test]
fn a_newer_or_foreign_sqlite_store_is_refused_and_keeps_its_bytes() {
    for (version, owner, kind, newer) in [
        (3, Some("dropkick"), "records", true),
        (1, None, "records", false),
        (1, Some("zipkit"), "records", false),
        (1, Some("dropkick"), "backups", false),
        (3, Some("dropkick"), "backups", false),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("existing.sqlite3");
        existing_store(&path, version, owner, kind);
        let before = fs::read(&path).unwrap();
        let error = format_version::open_sqlite(&path, Format::Records, "INVALID SQL;").unwrap_err();
        assert_eq!(error.contains("newer than this build"), newer, "{error}");
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
fn a_missing_malformed_or_foreign_header_is_unreadable_and_a_newer_one_is_reported() {
    let format = Format::Settings;
    let header = |owner: &str, kind: &str, version: serde_json::Value| {
        json!({ "format": { "owner": owner, "kind": kind, "version": version } })
    };
    for document in [
        json!({}),
        json!([1]),
        json!({ "formatVersion": 1 }),
        json!({ "version": "1.0.0" }),
        json!({ "format": "settings" }),
        json!({ "format": { "owner": "dropkick", "version": 1 } }),
        json!({ "format": { "kind": "settings", "version": 1 } }),
        header("dropkick", "settings", json!("1")),
        header("dropkick", "settings", json!(0)),
        header("dropkick", "settings", json!(null)),
        header("dropkick", "settings", json!(1.5)),
        header("fotoready", "settings", json!(1)),
        header("dropkick", "state", json!(1)),
        header("dropkick", "state", json!(3)),
    ] {
        assert!(format_version::json_value(&document, format).is_err(), "{document}");
    }
    assert!(format_version::json_bytes(b"{ not json", format).is_err());
    assert_eq!(format_version::json_value(&header("dropkick", "settings", json!(1)), format), Ok(Marker::Readable));
    assert_eq!(format_version::json_value(&header("dropkick", "settings", json!(3)), format), Ok(Marker::Newer(3)));
}

// `writer` is never read: any value, or none, leaves the judgement to `format`.
#[test]
fn the_writer_is_not_read() {
    let format = Format::Settings;
    for writer in [json!(null), json!("x"), json!({}), json!({ "name": "other", "version": 9 })] {
        let document = json!({ "format": { "owner": "dropkick", "kind": "settings", "version": 1, "extra": 1 }, "writer": writer });
        assert_eq!(format_version::json_value(&document, format), Ok(Marker::Readable));
    }
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
fn a_placement_file_without_a_header_is_set_aside() {
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
fn a_placement_file_round_trips_with_its_header() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("window.json");
    let text = file_text(placement()).unwrap();
    let written: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(written["format"], json!({ "owner": "dropkick", "kind": "windowPlacement", "version": 1 }));
    assert_eq!(written["writer"], json!({ "name": "dropkick", "version": env!("CARGO_PKG_VERSION") }));
    assert!(text.starts_with("{\n  \"format\": {"), "{text}");
    assert!(text.find("\"writer\"") < text.find("\"normal\""), "{text}");
    fs::write(&path, &text).unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Found(placement())));
}

#[test]
fn a_newer_placement_file_is_left_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("records-window.json");
    let text = r#"{"format":{"owner":"dropkick","kind":"windowPlacement","version":2},"bounds":[1,2,3,4]}"#;
    fs::write(&path, text).unwrap();
    assert_eq!(load_file(&path), Ok(SavedPlacement::Newer(2)));
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "nothing quarantined"
    );
}
