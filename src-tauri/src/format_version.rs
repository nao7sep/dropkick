//! Every file Dropkick writes in its own formats carries the file identity
//! header (file-identity-conventions): `format` says what it is (owner, kind,
//! version) and `writer` which build saved it. Each kind's version lives in one
//! table both halves of the app read, `src/models/format-versions.json`; this
//! module builds the header for the files the core writes and judges the
//! header of the files it loads or peeks at. `writer` is written, never read.

use std::collections::HashMap;
use std::sync::OnceLock;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The product that owns every format here.
pub const OWNER: &str = "dropkick";

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

    /// The format's `kind` in the header, and its key in the table.
    pub fn kind(self) -> &'static str {
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
            .get(self.kind())
            .unwrap_or_else(|| panic!("format-versions.json has no {}", self.kind()))
    }
}

/// A JSON file's `format` object, as this build writes it.
#[derive(Serialize)]
pub struct FormatHeader {
    owner: &'static str,
    kind: &'static str,
    version: u32,
}

/// A JSON file's `writer` object: this build.
#[derive(Serialize)]
pub struct WriterHeader {
    name: &'static str,
    version: &'static str,
}

pub fn format_header(format: Format) -> FormatHeader {
    FormatHeader { owner: OWNER, kind: format.kind(), version: format.current() }
}

pub fn writer_header() -> WriterHeader {
    WriterHeader { name: env!("CARGO_PKG_NAME"), version: env!("CARGO_PKG_VERSION") }
}

/// What a file's header says about it.
#[derive(Debug, PartialEq, Eq)]
pub enum Marker {
    /// This build reads it: the current version.
    Readable,
    /// Written by a newer build. It is intact data this build cannot read, so
    /// it is reported and left exactly in place.
    Newer(u64),
}

/// The owner, kind and version a `format` object names, when it is well formed.
fn identity(format: Option<&Value>) -> Result<(&str, &str, u64), String> {
    let format = format
        .and_then(Value::as_object)
        .ok_or_else(|| "format is missing or not an object".to_string())?;
    let text = |key: &str| {
        format
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("format.{key} is missing or not a string"))
    };
    let version = format
        .get("version")
        .and_then(Value::as_u64)
        .filter(|version| *version >= 1)
        .ok_or_else(|| "format.version is missing or not a positive integer".to_string())?;
    Ok((text("owner")?, text("kind")?, version))
}

// A file is readable only when its header names this owner and the expected
// kind; one of another format is unreadable whatever its version. Nothing is
// inferred from a file's shape.
fn judge(format_value: Option<&Value>, format: Format) -> Result<Marker, String> {
    let (owner, kind, version) = identity(format_value)?;
    if owner != OWNER || kind != format.kind() {
        return Err(format!("file is {owner} {kind}, not {OWNER} {}", format.kind()));
    }
    Ok(if version > u64::from(format.current()) {
        Marker::Newer(version)
    } else {
        Marker::Readable
    })
}

/// The header of a parsed JSON document.
pub fn json_value(document: &Value, format: Format) -> Result<Marker, String> {
    judge(document.get("format"), format)
}

// Only the header, so a file is judged before its body is parsed.
#[derive(Deserialize)]
struct HeaderOnly {
    #[serde(default)]
    format: Option<Value>,
}

/// The header of a JSON file's bytes; bytes that are not a JSON object are
/// unreadable, with the parser's own error.
pub fn json_bytes(bytes: &[u8], format: Format) -> Result<Marker, String> {
    let header = serde_json::from_slice::<HeaderOnly>(bytes).map_err(|e| e.to_string())?;
    judge(header.format.as_ref(), format)
}

/// The owner, kind and version a JSON document's header names, if it has a
/// well-formed one.
pub fn stamped(bytes: &[u8]) -> Option<(String, String, u64)> {
    let header = serde_json::from_slice::<HeaderOnly>(bytes).ok()?;
    let (owner, kind, version) = identity(header.format.as_ref()).ok()?;
    Some((owner.to_string(), kind.to_string(), version))
}

/// A SQLite store's version, `PRAGMA user_version`; reading it writes nothing.
/// 0 is SQLite's value for a database that never set one: a brand-new empty
/// database, which the caller stamps as it creates it, or an existing one
/// without its header, which is unreadable.
pub fn sqlite(conn: &Connection, format: Format) -> Result<Marker, String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let version = u64::try_from(version)
        .ok()
        .filter(|version| *version >= 1)
        .ok_or_else(|| "user_version is not a positive integer".to_string())?;
    Ok(if version > u64::from(format.current()) {
        Marker::Newer(version)
    } else {
        Marker::Readable
    })
}

// The rest of a SQLite store's header, one row per dotted key.
const HEADER_SCHEMA: &str =
    "CREATE TABLE file_header (key TEXT PRIMARY KEY, value TEXT NOT NULL);";

// Whether a SQLite store's file_header names this owner and the format's
// kind. A store without the table, or of another format, is unreadable.
fn sqlite_identity(conn: &Connection, format: Format) -> Result<(), String> {
    let row = |key: &str| -> Result<Option<String>, String> {
        match conn.query_row("SELECT value FROM file_header WHERE key = ?1", [key], |r| r.get(0)) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("file_header is unreadable: {error}")),
        }
    };
    let owner = row("format.owner")?;
    let kind = row("format.kind")?;
    if owner.as_deref() != Some(OWNER) || kind.as_deref() != Some(format.kind()) {
        return Err(format!(
            "file_header does not name {OWNER} {}",
            format.kind()
        ));
    }
    Ok(())
}

// Writes the header rows this build owns: the format rows on creation, the
// writer rows on every open for writing.
fn write_sqlite_header(conn: &Connection, format: Format, with_format: bool) -> Result<(), String> {
    let writer = writer_header();
    let mut rows = vec![("writer.name", writer.name), ("writer.version", writer.version)];
    if with_format {
        rows.splice(0..0, [("format.owner", OWNER), ("format.kind", format.kind())]);
    }
    for (key, value) in rows {
        conn.execute(
            "INSERT OR REPLACE INTO file_header (key, value) VALUES (?1, ?2)",
            [key, value],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Opens a store at its final path. A database with no version and no schema is
// new: a missing file, or the empty file a creation interrupted before its
// schema committed, which would otherwise be refused on every later launch.
// Schema, header and version commit in one transaction, so a store is never
// left partly initialized. An existing store's header is judged before
// anything is written; a readable one gets this build's writer rows.
pub fn open_sqlite(
    path: &std::path::Path,
    format: Format,
    schema: &str,
) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let version: i64 = tx
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let objects: i64 = tx
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version == 0 && objects == 0 {
        tx.execute_batch(schema).map_err(|e| e.to_string())?;
        tx.execute_batch(HEADER_SCHEMA).map_err(|e| e.to_string())?;
        write_sqlite_header(&tx, format, true)?;
        stamp_sqlite(&tx, format)?;
    } else {
        sqlite_identity(&tx, format)?;
        if let Marker::Newer(found) = sqlite(&tx, format)? {
            return Err(newer_message(path, found, format));
        }
        write_sqlite_header(&tx, format, false)?;
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

/// Records this build's version in a SQLite store it has just created.
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
