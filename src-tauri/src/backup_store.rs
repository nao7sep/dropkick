//! The data-backup history (data-backup conventions). It owns one SQLite file,
//! `backups.sqlite3`, directly under dropkick's storage root
//! (`DROPKICK_DATA_DIR` or `~/.dropkick`, resolved in one place by
//! `paths::data_root` — never a hardcoded path). Every managed text save hands
//! the exact bytes it just published to `record`, strictly AFTER its atomic
//! rename lands (see `write_atomic` in lib.rs). There is no startup scan, no
//! periodic pass, no restore path.
//!
//! Protected: task lists, preferences, workspaces and the saved locations in
//! `config.json` — what the user creates or maintains. Not recorded: state and
//! window placement (`write_atomic_unrecorded`, or `recordBackup: false`),
//! which are disposable; records (`records.sqlite3` and its fallback logs),
//! which are diagnostics the conventions keep out of the history; and this
//! store itself, which the backup layer writes directly.
//!
//! The history is best effort and never part of a save: `record` only queues the
//! bytes for one background owner, the `dropkick-backup` thread, which applies
//! them in save order, so a slow or locked store delays neither the save's reply
//! nor quit. Each session (one launch) keeps one row per path, updated in place
//! by later saves; a session's first save equal to the latest earlier row writes
//! nothing. At an ordinary quit the queue gets a short drain (`flush`); at the
//! end of an OS session it is skipped. Any failure logs one warning and is
//! swallowed. A successful record logs nothing.
//!
//! SQLite binding: `rusqlite` with the `bundled` feature, so the store needs no
//! system libsqlite3 and adds no packaging churn. A BLOB is stored and read as
//! raw bytes, so CR/LF, a BOM and non-UTF-8 content stay byte-identical.

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use rusqlite::{Connection, TransactionBehavior};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::format_version::{self, Format, Marker};
use crate::logging;

/// The table as this build creates it (format version 2). `content` is the
/// exact bytes written; `written_at_utc` is the serialized ISO-8601-ms form
/// (`2026-07-06T04:05:12.345Z`), never a filename stamp. `session_id` is the
/// launch that wrote the row, NULL for rows recorded before sessions; the
/// unique `(path, session_id)` index owns the per-session file list and the
/// `(path, id)` index serves the latest-row lookup.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS backups (
  id             INTEGER PRIMARY KEY,
  session_id     TEXT,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backups_path_session ON backups (path, session_id);
";

/// Format 1 recorded every distinct save without sessions. Its rows stay as
/// earlier history, with a NULL session.
const UPGRADE_FROM_1: &str = "
ALTER TABLE backups ADD COLUMN session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_backups_path_session ON backups (path, session_id);
";

/// How long an ordinary quit waits for queued records (lib.rs, at exit).
pub const QUIT_DRAIN: Duration = Duration::from_secs(1);

enum Job {
    Record { path: String, bytes: Vec<u8> },
    Flush(mpsc::SyncSender<()>),
}

struct Owner {
    sender: mpsc::Sender<Job>,
    // Joined only by close_for_test; the app lets process exit end the thread.
    #[cfg_attr(not(test), allow(dead_code))]
    thread: std::thread::JoinHandle<()>,
}

fn owner() -> &'static Mutex<Option<Owner>> {
    static OWNER: OnceLock<Mutex<Option<Owner>>> = OnceLock::new();
    OWNER.get_or_init(|| Mutex::new(None))
}

fn lock() -> std::sync::MutexGuard<'static, Option<Owner>> {
    // A poisoned lock still holds a usable sender.
    owner().lock().unwrap_or_else(|p| p.into_inner())
}

/// Starts the background owner for `store_file`. Returns at once: the store is
/// opened on the owner's thread, so a slow volume never holds up startup. If it
/// cannot open, one warning is logged and every record of the session is
/// dropped.
pub fn init(store_file: PathBuf) {
    // The launch's records session names its rows; a store started without
    // logging (a test) gets an id of its own.
    let session = logging::session().unwrap_or_else(crate::nanoid::generate);
    let (sender, jobs) = mpsc::channel();
    match std::thread::Builder::new()
        .name("dropkick-backup".to_string())
        .spawn(move || run(&store_file, &session, jobs))
    {
        Ok(thread) => *lock() = Some(Owner { sender, thread }),
        Err(err) => logging::warn(
            "backup store: could not start; recording disabled for this session",
            json!({ "error": { "message": err.to_string() } }),
        ),
    }
}

fn run(store_file: &Path, session: &str, jobs: mpsc::Receiver<Job>) {
    let mut conn = match open(store_file) {
        Ok(conn) => Some(conn),
        Err(err) => {
            logging::warn(
                "backup store: could not open; recording disabled for this session",
                json!({ "file": store_file.to_string_lossy(), "error": { "message": err } }),
            );
            None
        }
    };
    for job in jobs {
        match job {
            Job::Record { path, bytes } => {
                let Some(conn) = conn.as_mut() else { continue };
                if let Err(err) = try_record(conn, session, &path, &bytes) {
                    logging::warn(
                        "backup store: failed to record a managed write",
                        json!({ "file": path, "error": { "message": err.to_string() } }),
                    );
                }
            }
            Job::Flush(done) => {
                let _ = done.send(());
            }
        }
    }
}

fn open(store_file: &Path) -> Result<Connection, String> {
    // The store may be the first thing written on a fresh root.
    if let Some(parent) = store_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut conn = format_version::open_sqlite(store_file, Format::Backups, SCHEMA)?;
    // The marker is read before anything is written: a newer build's history is
    // left exactly as it is, and recording is off for the session.
    if let Marker::Newer(found) = format_version::sqlite(&conn, Format::Backups)? {
        return Err(format_version::newer_message(store_file, found, Format::Backups));
    }
    // busy_timeout lets a write wait briefly for SQLite's lock instead of
    // failing at once; the wait is the owner thread's, never a save's.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(|e| e.to_string())?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version == 1 {
        let upgrade = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        upgrade.execute_batch(UPGRADE_FROM_1).map_err(|e| e.to_string())?;
        format_version::stamp_sqlite(&upgrade, Format::Backups)?;
        upgrade.commit().map_err(|e| e.to_string())?;
    }
    Ok(conn)
}

/// SHA-256 of the exact bytes, lowercase hex.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Queues one managed text write for the history: `absolute_path` is the FULL
/// absolute path as written, `bytes` the exact bytes just published (never a
/// re-read of the file). Returns at once; a store that never opened drops it.
pub fn record(absolute_path: &Path, bytes: &[u8]) {
    if let Some(owner) = lock().as_ref() {
        let _ = owner.sender.send(Job::Record {
            path: absolute_path.to_string_lossy().into_owned(),
            bytes: bytes.to_vec(),
        });
    }
}

/// Waits up to `bound` for every record queued so far. True when they were
/// applied (or there is no owner); false when the bound passed first.
pub fn flush(bound: Duration) -> bool {
    let (done, finished) = mpsc::sync_channel(1);
    {
        let guard = lock();
        let Some(owner) = guard.as_ref() else { return true };
        if owner.sender.send(Job::Flush(done)).is_err() {
            return true;
        }
    }
    finished.recv_timeout(bound).is_ok()
}

/// Applies one record. The latest row for the path decides: equal content
/// writes nothing (an unchanged save, or a session's first save equal to the
/// previous session's last); otherwise this session's row is inserted or
/// replaced with the new bytes.
fn try_record(
    conn: &mut Connection,
    session: &str,
    path: &str,
    bytes: &[u8],
) -> Result<(), rusqlite::Error> {
    let hash = sha256_hex(bytes);
    let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    format_version::admit_sqlite(&transaction, Format::Backups)?;
    let latest: Option<String> = match transaction.query_row(
        "SELECT content_sha256 FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
        [path],
        |row| row.get::<_, String>(0),
    ) {
        Ok(h) => Some(h),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(other) => return Err(other),
    };
    if latest.as_deref() == Some(hash.as_str()) {
        transaction.commit()?;
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO backups (session_id, path, content, content_sha256, byte_size, written_at_utc) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (path, session_id) DO UPDATE SET content = excluded.content, \
         content_sha256 = excluded.content_sha256, byte_size = excluded.byte_size, \
         written_at_utc = excluded.written_at_utc",
        rusqlite::params![
            session,
            path,
            bytes,
            hash,
            bytes.len() as i64,
            logging::now_iso_millis()
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

/// Stops the owner after it applies what is queued, closing the store, so the
/// next `init` opens against another root. For tests; the app lets the process
/// exit close it.
#[cfg(test)]
pub fn close_for_test() {
    let owner = lock().take();
    if let Some(Owner { sender, thread }) = owner {
        drop(sender);
        let _ = thread.join();
    }
}

#[cfg(test)]
#[path = "../tests/unit/backup_store.rs"]
mod tests;
