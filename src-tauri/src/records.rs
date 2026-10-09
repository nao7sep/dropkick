//! What the Records window reads from `records.sqlite3`: a filtered page of
//! summaries, newest first and keyset-paged by a cursor; the launches that
//! have records; and one record whole, every field as stored.
//!
//! Reads open their own read-only connection, so they never queue behind the
//! logger's writer thread, and a reader never writes. The commands that call
//! these log only their failures: every stored record signals the Records
//! window, so a read that logged its success would start the next read.

use std::path::Path;
use std::time::Duration;

use rusqlite::types::Value as SqlValue;
use rusqlite::{params_from_iter, Connection, OpenFlags, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::format_version::{self, Format, Marker};

pub const PAGE_SIZE: usize = 100;

// How long a read waits for a writer's lock before it fails.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// The level filter: a record's own level, or `attention`, every record at
/// `warn` or `error`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LevelFilter {
    Attention,
    Error,
    Warn,
    Info,
    Debug,
}

impl LevelFilter {
    /// The one stored level the filter matches; `None` for `attention`.
    fn stored_level(self) -> Option<&'static str> {
        match self {
            LevelFilter::Attention => None,
            LevelFilter::Error => Some("error"),
            LevelFilter::Warn => Some("warn"),
            LevelFilter::Info => Some("info"),
            LevelFilter::Debug => Some("debug"),
        }
    }
}

/// Where the next page starts: the last summary of the page before it.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct RecordCursor {
    pub time: String,
    pub id: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordsQuery {
    /// A launch, named by its session.
    pub session: Option<String>,
    pub level: Option<LevelFilter>,
    #[serde(default)]
    pub search: String,
    pub after: Option<RecordCursor>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSummary {
    pub id: i64,
    pub session: String,
    pub time: String,
    pub level: String,
    pub message: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecordsPage {
    pub records: Vec<RecordSummary>,
    pub more: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDetail {
    pub id: i64,
    pub session: String,
    pub time: String,
    pub level: String,
    pub message: String,
    pub task_id: Option<String>,
    /// Every other field of the entry, as the JSON text the database holds.
    pub fields: String,
}

/// What the launch filter offers: every launch that has records, newest
/// first, and this one.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSources {
    pub current_session: Option<String>,
    pub sessions: Vec<String>,
}

/// Opens the database for reading. A newer build's records are not read: this
/// build cannot know what their rows mean.
pub fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(|e| e.to_string())?;
    if let Marker::Newer(found) = format_version::sqlite(&conn, Format::Records)? {
        return Err(format_version::newer_message(path, found, Format::Records));
    }
    Ok(conn)
}

// The search text as a LIKE pattern that matches it literally anywhere.
fn like_pattern(search: &str) -> Option<String> {
    let trimmed = search.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut pattern = String::from("%");
    for c in trimmed.chars() {
        if matches!(c, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    pattern.push('%');
    Some(pattern)
}

fn summary(row: &Row) -> rusqlite::Result<RecordSummary> {
    Ok(RecordSummary {
        id: row.get(0)?,
        session: row.get(1)?,
        time: row.get(2)?,
        level: row.get(3)?,
        message: row.get(4)?,
        task_id: row.get(5)?,
    })
}

pub fn read_page(conn: &Connection, query: &RecordsQuery) -> rusqlite::Result<RecordsPage> {
    let mut clauses: Vec<&str> = Vec::new();
    let mut params: Vec<SqlValue> = Vec::new();
    if let Some(session) = &query.session {
        clauses.push("session = ?");
        params.push(SqlValue::Text(session.clone()));
    }
    if let Some(level) = query.level {
        match level.stored_level() {
            Some(stored) => {
                clauses.push("level = ?");
                params.push(SqlValue::Text(stored.to_string()));
            }
            None => clauses.push("level IN ('warn', 'error')"),
        }
    }
    if let Some(pattern) = like_pattern(&query.search) {
        clauses.push(
            "(message LIKE ? ESCAPE '\\' OR task_id LIKE ? ESCAPE '\\' OR fields LIKE ? ESCAPE '\\')",
        );
        for _ in 0..3 {
            params.push(SqlValue::Text(pattern.clone()));
        }
    }
    if let Some(after) = &query.after {
        clauses.push("(time < ? OR (time = ? AND id < ?))");
        params.push(SqlValue::Text(after.time.clone()));
        params.push(SqlValue::Text(after.time.clone()));
        params.push(SqlValue::Integer(after.id));
    }
    let filter = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    params.push(SqlValue::Integer(PAGE_SIZE as i64 + 1));
    let mut statement = conn.prepare(&format!(
        "SELECT id, session, time, level, message, task_id FROM logs {filter} \
         ORDER BY time DESC, id DESC LIMIT ?"
    ))?;
    let mut records = statement
        .query_map(params_from_iter(params), summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let more = records.len() > PAGE_SIZE;
    records.truncate(PAGE_SIZE);
    Ok(RecordsPage { records, more })
}

pub fn read_sources(
    conn: &Connection,
    current_session: Option<String>,
) -> rusqlite::Result<RecordSources> {
    let mut statement = conn.prepare("SELECT DISTINCT session FROM logs ORDER BY session DESC")?;
    let sessions = statement
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(RecordSources {
        current_session,
        sessions,
    })
}

pub fn read_detail(conn: &Connection, id: i64) -> rusqlite::Result<Option<RecordDetail>> {
    conn.query_row(
        "SELECT id, session, time, level, message, task_id, fields FROM logs WHERE id = ?1",
        [id],
        |row| {
            Ok(RecordDetail {
                id: row.get(0)?,
                session: row.get(1)?,
                time: row.get(2)?,
                level: row.get(3)?,
                message: row.get(4)?,
                task_id: row.get(5)?,
                fields: row.get(6)?,
            })
        },
    )
    .optional()
}

#[cfg(test)]
#[path = "../tests/unit/records.rs"]
mod tests;
