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
    State,
    Preferences,
    Settings,
    TaskList,
    WindowPlacement,
    Backups,
    Records,
}

impl Format {
    // Every format, so a test can read each from the table.
    #[cfg(test)]
    pub const ALL: [Format; 7] = [
        Format::State,
        Format::Preferences,
        Format::Settings,
        Format::TaskList,
        Format::WindowPlacement,
        Format::Backups,
        Format::Records,
    ];

    fn key(self) -> &'static str {
        match self {
            Format::State => "state",
            Format::Preferences => "preferences",
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

// The label v0.1.0, the one published release before format markers, wrote
// into every JSON document it saved (developer decision: the next version
// opens those files). Its formats are this build's version 1: the body is the
// same shape, and the loaders convert what changed meaning. Nothing else is
// inferred from a file's shape.
pub const V010_LABEL: &str = "1.0.0";

// A store without a positive-integer marker is unreadable, unless it carries
// v0.1.0's label instead.
fn judge(found: Option<&Value>, label: Option<&Value>, format: Format) -> Result<Marker, String> {
    if found.is_none() && label.and_then(Value::as_str) == Some(V010_LABEL) {
        return Ok(Marker::Readable);
    }
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
    judge(document.get("formatVersion"), document.get("version"), format)
}

// Only the marker, so a store is judged before its body is parsed.
#[derive(Deserialize)]
struct MarkerOnly {
    #[serde(default, rename = "formatVersion")]
    format_version: Option<Value>,
    #[serde(default)]
    version: Option<Value>,
}

/// The marker of a JSON file's bytes; bytes that are not a JSON object are
/// unreadable, with the parser's own error.
pub fn json_bytes(bytes: &[u8], format: Format) -> Result<Marker, String> {
    let marker = serde_json::from_slice::<MarkerOnly>(bytes).map_err(|e| e.to_string())?;
    judge(marker.format_version.as_ref(), marker.version.as_ref(), format)
}

/// Whether JSON bytes are a document v0.1.0 wrote: its label, no marker.
pub fn is_v010(bytes: &[u8]) -> bool {
    serde_json::from_slice::<MarkerOnly>(bytes).is_ok_and(|marker| {
        marker.format_version.is_none()
            && marker.version.as_ref().and_then(Value::as_str) == Some(V010_LABEL)
    })
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
    judge(Some(&Value::from(version)), None, format)
}

pub fn open_sqlite(
    path: &std::path::Path,
    format: Format,
    schema: &str,
) -> Result<Connection, String> {
    open_sqlite_with_publish(path, format, schema, crate::publish_new)
}

fn open_existing_sqlite(path: &std::path::Path, format: Format) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    if let Marker::Newer(found) = sqlite(&conn, format)? {
        return Err(newer_message(path, found, format));
    }
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn open_sqlite_with_publish(
    path: &std::path::Path,
    format: Format,
    schema: &str,
    publish: impl FnOnce(&std::path::Path, &std::path::Path) -> std::io::Result<()>,
) -> Result<Connection, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => return open_existing_sqlite(path, format),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.to_string()),
    }
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;
    let stage_dir = parent.join(crate::atomic_temp_name(file_name));
    let directory = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let directory = {
        use std::os::unix::fs::DirBuilderExt;
        let mut directory = directory;
        directory.mode(0o700);
        directory
    };
    directory.create(&stage_dir).map_err(|e| e.to_string())?;
    struct Stage(std::path::PathBuf);
    impl Drop for Stage {
        fn drop(&mut self) {
            // This invocation exclusively created the private directory. Never
            // sweep sibling stages: they may belong to another live writer.
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let stage = Stage(stage_dir);
    let staged_path = stage.0.join(file_name);
    let mut conn = Connection::open(&staged_path).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    tx.execute_batch(schema).map_err(|e| e.to_string())?;
    stamp_sqlite(&tx, format)?;
    tx.commit().map_err(|e| e.to_string())?;
    // The default DELETE journal keeps the committed store in one file. Close
    // before publication so no connection or sidecar follows its old pathname.
    conn.close().map_err(|(_, e)| e.to_string())?;
    match publish(&staged_path, path) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error.to_string()),
    }
    open_existing_sqlite(path, format)
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
