//! Every store's format version (store-recovery-conventions): one integer per
//! format, independent of the app's version and of the other formats. The
//! numbers live in one table both halves of the app read,
//! `src/models/format-versions.json`; this module reads the formats the core
//! itself loads or peeks at, and judges a store's marker against them.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::Connection;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

const TABLE: &str = include_str!("../../src/models/format-versions.json");

/// The formats the Rust core reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    State,
    Preferences,
    TaskList,
    WindowPlacement,
    Backups,
    Records,
}

impl Format {
    pub const ALL: [Format; 6] = [
        Format::State,
        Format::Preferences,
        Format::TaskList,
        Format::WindowPlacement,
        Format::Backups,
        Format::Records,
    ];

    fn key(self) -> &'static str {
        match self {
            Format::State => "state",
            Format::Preferences => "preferences",
            Format::TaskList => "taskList",
            Format::WindowPlacement => "windowPlacement",
            Format::Backups => "backups",
            Format::Records => "records",
        }
    }

    /// The version this build writes and reads. The table is compiled in, and
    /// a test reads every format, so a missing entry fails the test run rather
    /// than a launch.
    pub fn current(self) -> u32 {
        static VERSIONS: OnceLock<HashMap<String, u32>> = OnceLock::new();
        let versions = VERSIONS.get_or_init(|| {
            serde_json::from_str(TABLE).expect("format-versions.json is a map of integers")
        });
        *versions
            .get(self.key())
            .unwrap_or_else(|| panic!("format-versions.json has no {}", self.key()))
    }
}

/// What a store's marker says about it.
#[derive(Debug, PartialEq, Eq)]
pub enum Marker {
    /// This build reads it: the current version, an older one, or no marker.
    Readable,
    /// Written by a newer build. It is intact data this build cannot read, so
    /// it is reported and left exactly in place.
    Newer(u64),
}

// A marker that is present but not a positive integer is a shape failure; an
// absent one reads as 1.
fn judge(found: Option<&Value>, format: Format) -> Result<Marker, String> {
    let version = match found {
        None => 1,
        Some(value) => value
            .as_u64()
            .filter(|version| *version >= 1)
            .ok_or_else(|| "formatVersion is not a positive integer".to_string())?,
    };
    Ok(if version > u64::from(format.current()) {
        Marker::Newer(version)
    } else {
        Marker::Readable
    })
}

/// The marker of a parsed JSON document. A document that is not an object is
/// left to its reader's own shape check.
pub fn json_value(document: &Value, format: Format) -> Result<Marker, String> {
    match document {
        Value::Object(map) => judge(map.get("formatVersion"), format),
        _ => Ok(Marker::Readable),
    }
}

// Only the marker, so a store is judged before its body is parsed. A present
// `null` is kept as a value, not read as absent.
#[derive(Deserialize)]
struct MarkerOnly {
    #[serde(default, rename = "formatVersion", deserialize_with = "present")]
    format_version: Option<Value>,
}

fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

/// The marker of a JSON file's bytes. Bytes that are not a JSON object are
/// left to the reader's own parse, which reports the real error.
pub fn json_bytes(bytes: &[u8], format: Format) -> Result<Marker, String> {
    match serde_json::from_slice::<MarkerOnly>(bytes) {
        Ok(marker) => judge(marker.format_version.as_ref(), format),
        Err(_) => Ok(Marker::Readable),
    }
}

/// A SQLite store's marker, `PRAGMA user_version`. Reading it writes nothing;
/// 0 is SQLite's value for a file that never set one, so it reads as 1.
pub fn sqlite(conn: &Connection, format: Format) -> Result<Marker, String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    judge(Some(&Value::from(version.max(1))), format)
}

/// Records this build's version in a SQLite store it has just opened and
/// judged readable.
pub fn stamp_sqlite(conn: &Connection, format: Format) -> Result<(), String> {
    conn.pragma_update(None, "user_version", format.current())
        .map_err(|e| e.to_string())
}

/// The error a store reader reports for a newer file, naming the file.
pub fn newer_message(file: &std::path::Path, found: u64, format: Format) -> String {
    format!(
        "{} has format version {found}, newer than this build reads ({}); left in place",
        file.display(),
        format.current()
    )
}
