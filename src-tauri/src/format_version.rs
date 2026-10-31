//! Every store's format version (store-recovery-conventions): one integer per
//! format, independent of the app's version and of the other formats. The
//! numbers live in one table both halves of the app read,
//! `src/models/format-versions.json`; this module reads the formats the core
//! itself loads or peeks at, and judges a store's marker against them.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;

const TABLE: &str = include_str!("../../src/models/format-versions.json");

/// The formats the Rust core reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Settings,
    TaskList,
    WindowPlacement,
    Backups,
    Records,
}

impl Format {
    // Every format, so a test can read each from the table.
    #[cfg(test)]
    pub const ALL: [Format; 5] = [
        Format::Settings,
        Format::TaskList,
        Format::WindowPlacement,
        Format::Backups,
        Format::Records,
    ];

    fn key(self) -> &'static str {
        match self {
            Format::Settings => "settings",
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
    /// This build reads it: the current version or an older one.
    Readable,
    /// Written by a newer build. It is intact data this build cannot read, so
    /// it is reported and left exactly in place.
    Newer(u64),
}

// A store without a positive-integer marker is unreadable. Nothing is inferred
// from a file's shape.
fn judge(found: Option<&Value>, format: Format) -> Result<Marker, String> {
    let version = found
        .and_then(Value::as_u64)
        .filter(|version| *version >= 1)
        .ok_or_else(|| "formatVersion is missing or not a positive integer".to_string())?;
    Ok(if version > u64::from(format.current()) {
        Marker::Newer(version)
    } else {
        Marker::Readable
    })
}

/// The marker of a parsed JSON document.
pub fn json_value(document: &Value, format: Format) -> Result<Marker, String> {
    judge(document.get("formatVersion"), format)
}

// Only the marker, so a store is judged before its body is parsed.
#[derive(Deserialize)]
struct MarkerOnly {
    #[serde(default, rename = "formatVersion")]
    format_version: Option<Value>,
}

/// The marker of a JSON file's bytes; bytes that are not a JSON object are
/// unreadable, with the parser's own error.
pub fn json_bytes(bytes: &[u8], format: Format) -> Result<Marker, String> {
    let marker = serde_json::from_slice::<MarkerOnly>(bytes).map_err(|e| e.to_string())?;
    judge(marker.format_version.as_ref(), format)
}

/// The positive-integer marker a JSON document carries, if any.
pub fn stamped(bytes: &[u8]) -> Option<u64> {
    serde_json::from_slice::<MarkerOnly>(bytes)
        .ok()?
        .format_version
        .as_ref()
        .and_then(Value::as_u64)
        .filter(|version| *version >= 1)
}

/// A SQLite store's marker, `PRAGMA user_version`; reading it writes nothing.
/// 0 is SQLite's value for a database that never set one: a brand-new empty
/// database, which the caller stamps as it creates it, or an existing one
/// without its marker, which is unreadable.
pub fn sqlite(conn: &Connection, format: Format) -> Result<Marker, String> {
    let read = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |row| row.get(0))
            .map_err(|e| e.to_string())
    };
    let version = read("PRAGMA user_version")?;
    judge(Some(&Value::from(version)), format)
}

// Opens a store at its final path. A database with no marker and no schema is
// new: a missing file, or the empty file a creation interrupted before its
// schema committed, which would otherwise be refused on every later launch.
// Schema and marker commit in one transaction, so a store is never left
// partly initialized.
pub fn open_sqlite(
    path: &std::path::Path,
    format: Format,
    schema: &str,
) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let marker: i64 = tx
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let objects: i64 = tx
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if marker == 0 && objects == 0 {
        tx.execute_batch(schema).map_err(|e| e.to_string())?;
        stamp_sqlite(&tx, format)?;
    } else if let Marker::Newer(found) = sqlite(&tx, format)? {
        return Err(newer_message(path, found, format));
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn admit_sqlite(conn: &Connection, format: Format) -> rusqlite::Result<()> {
    let issue = match sqlite(conn, format) {
        Ok(Marker::Readable) => return Ok(()),
        Ok(Marker::Newer(found)) => format!("store format {found} is newer than this build"),
        Err(issue) => issue,
    };
    Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
        std::io::Error::other(issue),
    )))
}

/// Records this build's version in a SQLite store it has just opened and
/// judged readable.
pub fn stamp_sqlite(conn: &Connection, format: Format) -> Result<(), String> {
    conn.pragma_update(None, "user_version", format.current())
        .map_err(|e| e.to_string())
}

/// The error a store reader reports for a newer file, naming the file.
pub fn newer_message(file: &std::path::Path, found: u64, format: Format) -> String {
    newer_than_message(file, found, u64::from(format.current()))
}

/// The same error against a version the caller names.
pub fn newer_than_message(file: &std::path::Path, found: u64, current: u64) -> String {
    format!(
        "{} has format version {found}, newer than this build reads ({current}); left in place",
        file.display()
    )
}

#[cfg(test)]
#[path = "../tests/unit/format_version.rs"]
mod tests;
