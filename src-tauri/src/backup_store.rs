//! The write-through data-backup store (data-backup conventions). It owns one
//! add-only SQLite file, `backups.sqlite3`, directly under dropkick's storage
//! root (`DROPKICK_HOME` or `~/.dropkick`, resolved in one place by
//! `paths::data_root` — never a hardcoded path). Every managed *text* save
//! records the exact bytes it just wrote here, strictly AFTER its atomic rename
//! lands (see `write_atomic` in lib.rs), so the history is always as current as
//! the last save. There is no startup scan, no periodic pass, no restore path.
//!
//! SQLite binding: `rusqlite` with the `bundled` feature. Bundled compiles
//! SQLite from source into the binary, so the store needs no system libsqlite3
//! and adds no packaging churn — the lowest-friction binding for the Rust core,
//! per the convention's "built-in or lowest-friction binding" rule. It is
//! synchronous, exactly what a record-after-rename hook wants, and stores/reads
//! a BLOB as raw `&[u8]`/`Vec<u8>` so CR/LF, a BOM, and non-UTF-8 bytes are
//! byte-identical.
//!
//! Two absolute musts drive every line below (they are not best-effort
//! aspirations):
//!
//!  - It never breaks a save and never crashes the app. The save has already
//!    succeeded — the file is on disk before `record` is called — so any failure
//!    here (the DB is locked, the disk is full, an insert fails) is caught,
//!    logged once at `warn`, and swallowed. A lost record self-heals on the next
//!    save of that file, whose content will differ from the last recorded row.
//!    Nothing here ever panics or propagates an error to the caller.
//!  - It logs only failures. A successful record logs NOTHING; a line per save
//!    would flood the log.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rusqlite::{Connection, TransactionBehavior};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::logging;

/// The one add-only table. `content` is a BLOB of the exact bytes written —
/// never decoded text, so CR/LF, a BOM, and non-UTF-8 bytes are stored
/// byte-identically. `written_at_utc` is the serialized ISO-8601-ms form
/// (`2026-07-06T04:05:12.345Z`), a data value — NEVER the
/// `yyyymmdd-hhmmss-fff-utc` filename stamp. The `(path, id)` index serves the
/// latest-row-per-path dedup lookup.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS backups (
  id             INTEGER PRIMARY KEY,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
";

/// Session state for the store singleton.
///
/// `initialized` records that `init` has run; `conn` is `Some` when the store is
/// open and `None` when it could not be opened (a single warn was already logged,
/// and every later `record` becomes a no-op rather than retrying a broken open on
/// every save). Wrapped in a `Mutex` because `record` is called synchronously
/// from the atomic-write path, which may run on any thread, and a
/// `rusqlite::Connection` is not `Sync`.
struct StoreState {
    conn: Option<Connection>,
    initialized: bool,
}

fn store() -> &'static Mutex<StoreState> {
    static STORE: OnceLock<Mutex<StoreState>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(StoreState {
            conn: None,
            initialized: false,
        })
    })
}

/// Open and initialize the store once, at startup, best-effort. Creates the
/// `backups.sqlite3` file's parent directory if needed, opens the connection,
/// switches on WAL, sets a busy timeout, and creates the table + index. On any
/// failure it logs ONE `warn`, leaves recording disabled for the session, and
/// never panics — startup is never blocked by a backup-store problem.
///
/// WAL is what lets the tolerated two-instance case (two dropkick windows writing
/// at once) serialize safely without a cross-process lock; `busy_timeout` makes a
/// contended write *wait* for SQLite's write lock (up to ~5s) rather than
/// immediately failing with `SQLITE_BUSY` and dropping that record.
pub fn init(store_file: PathBuf) {
    let mut state = lock();
    state.initialized = true;
    match open(&store_file) {
        Ok(conn) => state.conn = Some(conn),
        Err(err) => {
            logging::warn(
                "backup store: could not open; recording disabled for this session",
                json!({ "file": store_file.to_string_lossy(), "error": { "message": err } }),
            );
            state.conn = None;
        }
    }
}

fn open(store_file: &Path) -> Result<Connection, String> {
    // not recorded: backups.sqlite3 is the store itself — binary, and written by
    // this backup layer, not through the managed-text atomic-write path — so it
    // never records itself. No recursion, no special case (data-backup
    // conventions: "A binary store, excluded from itself").
    // The first writer under the root does the `mkdir -p`; the store may be the
    // first thing written on a fresh root.
    if let Some(parent) = store_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(store_file).map_err(|e| e.to_string())?;
    // WAL for the tolerated two-instance case; busy_timeout so a contended write
    // waits (~5s) instead of dropping the record with SQLITE_BUSY.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

/// SHA-256 of the exact bytes, lowercase hex.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Record one managed-text write: `absolute_path` is the FULL absolute path of
/// the file as written; `bytes` is the exact raw bytes just written (the caller
/// already holds them — never a re-read of the file).
///
/// Dedup by content hash per path: the new content's SHA-256 is compared against
/// the latest row for the same `path`, and the insert is SKIPPED when they are
/// equal. This collapses consecutive identical saves (an autosave with no real
/// change writes no row) while still recording every genuinely distinct version —
/// including a revert, whose content differs from the immediately preceding row.
///
/// Best-effort and silent on success; any failure is caught, logged once at
/// `warn` (file + reason), and swallowed. It never panics, never crashes the app,
/// and never breaks the save.
pub fn record(absolute_path: &Path, bytes: &[u8]) {
    let mut state = lock();
    let Some(conn) = state.conn.as_mut() else {
        // Store never opened (open failed at startup, or init hasn't run under a
        // test that doesn't exercise it): disabled for the session, already warned
        // once if it was an open failure. No-op.
        return;
    };
    let path = absolute_path.to_string_lossy();
    if let Err(err) = try_record(conn, &path, bytes) {
        logging::warn(
            "backup store: failed to record a managed write",
            json!({ "file": path, "error": { "message": err.to_string() } }),
        );
    }
}

/// The fallible core of `record`, factored out so the one `warn` site in `record`
/// catches every failure path uniformly.
fn try_record(conn: &mut Connection, path: &str, bytes: &[u8]) -> Result<(), rusqlite::Error> {
    let hash = sha256_hex(bytes);
    // Acquire SQLite's cross-process write reservation before reading the
    // predecessor. Without one transaction, two app processes can both read
    // the same latest hash and then append the same next version. WAL and the
    // busy timeout serialize the inserts, but cannot repair that stale read.
    let transaction = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // Compare against the latest row for this same path only — a cheap,
    // append-only check with no full-history scan (served by the (path, id)
    // index). No prior row (QueryReturnedNoRows) means never captured -> record.
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
        return Ok(()); // unchanged since the last recorded version — dedup skip
    }
    transaction.execute(
        "INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
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

fn lock() -> std::sync::MutexGuard<'static, StoreState> {
    // Recover from a poisoned mutex: a prior panic elsewhere must not wedge the
    // store shut. (Nothing in this module panics while holding the lock, so the
    // recovered state is consistent.)
    store().lock().unwrap_or_else(|p| p.into_inner())
}

/// Close the store and reset the singleton (best-effort). For tests that need to
/// release the file handle between throwaway roots so the next `init` re-opens
/// against the current root; the app itself lets the process exit close it.
#[cfg(test)]
pub fn close_for_test() {
    let mut state = lock();
    // Dropping the Connection closes it.
    state.conn = None;
    state.initialized = false;
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the store is a process-global singleton, and resetting it
// between throwaway roots needs `close_for_test`, which is #[cfg(test)]-gated and therefore absent
// from the library an integration test would link against. Un-gating it would ship a reset hook
// the app must never call.
#[path = "../tests/unit/backup_store.rs"]
mod tests;
