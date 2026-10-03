// The logger: each log line is a row in `records.sqlite3` (logging-conventions,
// data-lifecycle-conventions' Records). The privileged Rust core is the
// database's only writer; the sandboxed webview frontend forwards structured
// log objects to it (see `emit_forwarded` and the `log_event` command in
// lib.rs).
//
// A row holds the event `time`, its `session` (this launch's start time), the
// `level`, the `message`, the `task_id` when the entry names a `taskId`, and
// every other field as one JSON object. An entry the database cannot take is
// appended as one JSON line, carrying the database's error, to
// `logs/<yyyymmdd-hhmmss-fff-utc>.log` named for the session; if that fails too
// it goes to stderr. Logging never panics.
//
// The core's own entries are written by one writer thread, in the order they
// were logged, so a slow or locked database never holds the thread that logged
// them (the main thread, for window and menu events). `flush` waits, bounded,
// for that thread to catch up; the exit and panic paths call it.
//
// After each entry the database stores, the listener set with `on_stored`
// runs; it tells the Records window (records_window::notify_changed).

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, ThreadId};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde_json::{Map, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }

    fn parse(s: &str) -> Option<Level> {
        match s {
            "debug" => Some(Level::Debug),
            "info" => Some(Level::Info),
            "warn" => Some(Level::Warn),
            "error" => Some(Level::Error),
            _ => None,
        }
    }
}

// --- Time (UTC ISO 8601 ms + the filename stamp), hand-rolled, no date crate ---

fn now_unix_millis() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        // A clock set before the epoch is not a real case; stay total anyway.
        Err(e) => -(e.duration().as_millis() as i64),
    }
}

// Howard Hinnant's days-from-civil inverse: `z` is days since 1970-01-01.
// Returns (year, month [1..12], day [1..31]).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

// Breaks a UTC instant (unix millis) into calendar parts. `div_euclid` /
// `rem_euclid` keep this correct for instants before the epoch as well.
fn parts_from_millis(ms: i64) -> (i64, u32, u32, u32, u32, u32, u32) {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000); // [0, 86_400_000)
    let (year, month, day) = civil_from_days(days);
    let secs = rem / 1_000;
    let milli = (rem % 1_000) as u32;
    let hour = (secs / 3_600) as u32;
    let minute = ((secs % 3_600) / 60) as u32;
    let second = (secs % 60) as u32;
    (year, month, day, hour, minute, second, milli)
}

pub fn iso_millis(ms: i64) -> String {
    let (y, mo, d, h, mi, s, ms3) = parts_from_millis(ms);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms3:03}Z")
}

// The current instant as the serialized ISO-8601 UTC-with-milliseconds form
// (`2026-07-06T04:05:12.345Z`) — the timestamp-conventions' internal/serialized
// shape, a data value. Reuses the same `iso_millis` formatter the log lines use
// so there is one time formatter, never a fourth. The data-backup store stamps
// its `written_at_utc` column with this — NEVER the `yyyymmdd-hhmmss-fff-utc`
// filename stamp (`filename_stamp` above), which belongs to file names only.
pub fn now_iso_millis() -> String {
    iso_millis(now_unix_millis())
}

pub fn filename_stamp(ms: i64) -> String {
    let (y, mo, d, h, mi, s, ms3) = parts_from_millis(ms);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}-{ms3:03}-utc")
}

// The bare filename stamp for other derived-sibling names that carry a moment
// discriminator (a quarantined store's `<stem>-<stamp>.invalid`) — the same
// formatter as the session's fallback log name, so there is exactly one
// filename stamp.
pub fn filename_stamp_now() -> String {
    filename_stamp(now_unix_millis())
}

// --- The logger itself ---

// Public so the records reader's tests can build a database of this shape.
pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY,
  time    TEXT NOT NULL,
  session TEXT NOT NULL,
  level   TEXT NOT NULL,
  message TEXT NOT NULL,
  task_id TEXT,
  fields  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_session ON logs (session, id);
CREATE INDEX IF NOT EXISTS idx_logs_task_id ON logs (task_id, id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs (time, id);
";

// `Err` holds why the database could not be opened; every entry of the session
// then takes the fallback.
type Records = Result<Connection, String>;

// How long a write waits for another running instance's write to finish.
const BUSY_TIMEOUT_MS: u64 = 5_000;
// Long enough for an entry that waits its full busy timeout to land.
const FLUSH_BOUND: Duration = Duration::from_millis(BUSY_TIMEOUT_MS + 1_000);

enum Job {
    Write(Map<String, Value>),
    Flush(SyncSender<()>),
}

struct Writer {
    jobs: Sender<Job>,
    thread: ThreadId,
}

impl Writer {
    fn spawn(logger: &'static Logger) -> std::io::Result<Writer> {
        let (jobs, queue) = mpsc::channel();
        let handle = thread::Builder::new()
            .name("dropkick-log".to_string())
            .spawn(move || {
                for job in queue {
                    match job {
                        Job::Write(obj) => logger.write_envelope(obj),
                        Job::Flush(done) => {
                            let _ = done.send(());
                        }
                    }
                }
            })?;
        Ok(Writer {
            jobs,
            thread: handle.thread().id(),
        })
    }
}

pub struct Logger {
    records: Mutex<Records>,
    records_file: PathBuf,
    session: String,
    fallback_file: PathBuf,
    debug_enabled: bool,
    // Unset until `init` starts the thread; entries are written inline until then.
    writer: OnceLock<Writer>,
    // Called after each entry the database stored; an entry that went to the
    // fallback file is not in the database, so it calls nothing.
    stored: OnceLock<Box<dyn Fn() + Send + Sync>>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

impl Logger {
    fn open(records_file: &Path, logs_dir: &Path, debug_enabled: bool) -> Logger {
        let started = now_unix_millis();
        Logger {
            records: Mutex::new(open_records(records_file)),
            records_file: records_file.to_path_buf(),
            session: iso_millis(started),
            fallback_file: logs_dir.join(format!("{}.log", filename_stamp(started))),
            debug_enabled,
            writer: OnceLock::new(),
            stored: OnceLock::new(),
        }
    }

    // Starts the writer thread. A logger without one writes inline.
    fn start_writer(&'static self) {
        match Writer::spawn(self) {
            Ok(writer) => {
                let _ = self.writer.set(writer);
            }
            Err(e) => eprintln!("[dropkick:logging] writer thread failed to start: {e}"),
        }
    }
}

// Opens this launch's session against `records_file` and installs the
// process-global logger. Call once.
pub fn init(records_file: &Path, logs_dir: &Path, debug_enabled: bool) {
    if LOGGER.set(Logger::open(records_file, logs_dir, debug_enabled)).is_err() {
        eprintln!("[dropkick:logging] logger already initialized; ignoring re-init");
        return;
    }
    if let Some(logger) = LOGGER.get() {
        logger.start_writer();
    }
}

fn open_records(records_file: &Path) -> Records {
    if let Some(parent) = records_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(records_file).map_err(|e| e.to_string())?;
    // WAL with synchronous=NORMAL keeps every committed row through an app
    // crash; busy_timeout lets a second running instance's write wait its turn.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", BUSY_TIMEOUT_MS as i64)
        .map_err(|e| e.to_string())?;
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(conn)
}

// The envelope keys a row holds in columns. One that is not a string stays in
// `fields`, so nothing given is lost.
fn insert(conn: &Connection, session: &str, obj: &Map<String, Value>) -> rusqlite::Result<()> {
    let column = |key: &str| obj.get(key).and_then(Value::as_str);
    let fields: Map<String, Value> = obj
        .iter()
        .filter(|(key, _)| {
            !matches!(key.as_str(), "time" | "level" | "message" | "taskId")
                || column(key).is_none()
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    conn.execute(
        "INSERT INTO logs (time, session, level, message, task_id, fields) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            column("time").map_or_else(now_iso_millis, str::to_string),
            session,
            column("level").unwrap_or_default(),
            column("message").unwrap_or_default(),
            column("taskId"),
            Value::Object(fields).to_string(),
        ],
    )?;
    Ok(())
}

fn global() -> Option<&'static Logger> {
    LOGGER.get()
}

pub fn debug_enabled() -> bool {
    global().map(|l| l.debug_enabled).unwrap_or(false)
}

// This launch's session, as every record of it carries.
pub fn session() -> Option<String> {
    global().map(|l| l.session.clone())
}

// The records database this session writes to.
pub fn records_file() -> Option<PathBuf> {
    global().map(|l| l.records_file.clone())
}

// Sets what runs after each entry the database stored. Set once.
pub fn on_stored(listener: impl Fn() + Send + Sync + 'static) {
    if let Some(logger) = global() {
        logger.set_stored_listener(listener);
    }
}

impl Logger {
    // Writes one envelope as one row. Both emit() and emit_forwarded() funnel
    // through here, so every entry passes the identical write contract.
    fn write_envelope(&self, mut obj: Map<String, Value>) {
        // Recover from a poisoned mutex: a prior panic-while-writing must not
        // wedge logging shut, least of all the panic hook trying to record it.
        let records = self.records.lock().unwrap_or_else(|p| p.into_inner());
        let outcome = match &*records {
            Ok(conn) => insert(conn, &self.session, &obj).map_err(|e| e.to_string()),
            Err(e) => Err(e.clone()),
        };
        drop(records);
        let error = match outcome {
            Ok(()) => {
                if let Some(listener) = self.stored.get() {
                    listener();
                }
                return;
            }
            Err(error) => error,
        };
        obj.insert("recordsError".to_string(), Value::String(error));
        let mut line = Value::Object(obj).to_string();
        line.push('\n');
        if let Err(e) = self.append_fallback(&line) {
            eprintln!("[dropkick:logging] fallback write failed: {e}");
            eprint!("{line}");
        }
    }

    fn set_stored_listener(&self, listener: impl Fn() + Send + Sync + 'static) {
        if self.stored.set(Box::new(listener)).is_err() {
            eprintln!("[dropkick:logging] stored listener already set; ignoring");
        }
    }

    fn append_fallback(&self, line: &str) -> std::io::Result<()> {
        if let Some(parent) = self.fallback_file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.fallback_file)?
            .write_all(line.as_bytes())
    }

    // Hands an envelope to the writer thread, behind every entry handed to it
    // before. It is written inline when there is no writer thread, when the
    // writer has stopped, or when the writer itself is logging (its panic).
    fn submit(&self, obj: Map<String, Value>) {
        let Some(writer) = self.writer.get() else {
            return self.write_envelope(obj);
        };
        if thread::current().id() == writer.thread {
            return self.write_envelope(obj);
        }
        if let Err(mpsc::SendError(Job::Write(obj))) = writer.jobs.send(Job::Write(obj)) {
            self.write_envelope(obj);
        }
    }

    // Waits, within FLUSH_BOUND, until every entry submitted before it is
    // written. Past the bound the remaining entries' outcome is unknown.
    fn flush(&self) {
        let Some(writer) = self.writer.get() else {
            return;
        };
        if thread::current().id() == writer.thread {
            return;
        }
        let (done, finished) = mpsc::sync_channel(1);
        if writer.jobs.send(Job::Flush(done)).is_ok() {
            let _ = finished.recv_timeout(FLUSH_BOUND);
        }
    }

    // Builds the envelope from a Rust-side event, stamped now, and submits it.
    // `fields` is merged in; the envelope keys (time/level/message) always win.
    fn emit(&self, level: Level, message: &str, fields: Value) {
        if level == Level::Debug && !self.debug_enabled {
            return;
        }
        let mut obj = Map::new();
        obj.insert(
            "time".to_string(),
            Value::String(iso_millis(now_unix_millis())),
        );
        obj.insert(
            "level".to_string(),
            Value::String(level.as_str().to_string()),
        );
        obj.insert("message".to_string(), Value::String(message.to_string()));
        if let Value::Object(extra) = fields {
            for (key, val) in extra {
                if key != "time" && key != "level" && key != "message" {
                    obj.insert(key, val);
                }
            }
        }
        self.submit(obj);
    }

    // Writes an object the frontend already shaped (it stamped `time` at the
    // event instant). We re-apply the debug gate so every entry went through the
    // same writer contract.
    fn emit_forwarded(&self, value: Value) {
        let mut obj = match value {
            Value::Object(map) => map,
            other => {
                // Defensive: a non-object payload is wrapped, never dropped.
                let mut map = Map::new();
                map.insert("forwarded".to_string(), other);
                map
            }
        };
        let level = obj
            .get("level")
            .and_then(|v| v.as_str())
            .and_then(Level::parse)
            .unwrap_or(Level::Info);
        if level == Level::Debug && !self.debug_enabled {
            return;
        }
        // Keep the frontend's `time`/`message` (the event instant and wording),
        // but always normalize `level` to the value we actually gated on — so an
        // unrecognized or missing level can never make the written level disagree
        // with how the line was handled.
        obj.entry("time".to_string())
            .or_insert_with(|| Value::String(iso_millis(now_unix_millis())));
        obj.insert(
            "level".to_string(),
            Value::String(level.as_str().to_string()),
        );
        obj.entry("message".to_string())
            .or_insert_with(|| Value::String(String::new()));
        self.submit(obj);
    }
}

// --- Free functions over the process-global logger (used by lib.rs) ---

fn emit(level: Level, message: &str, fields: Value) {
    if let Some(logger) = global() {
        logger.emit(level, message, fields);
    } else if level != Level::Debug {
        // No logger yet (e.g. a panic during early startup): best effort.
        eprintln!("[dropkick:logging:{}] {message} {fields}", level.as_str());
    }
}

pub fn debug(message: &str, fields: Value) {
    emit(Level::Debug, message, fields);
}

pub fn info(message: &str, fields: Value) {
    emit(Level::Info, message, fields);
}

// One `warn` line is what the data-backup store logs when it cannot open
// (recording disabled for the session) or when a single record fails — the
// convention's "logs only failures, one warn line" contract. The frontend's
// warnings also arrive pre-leveled through `emit_forwarded`.
pub fn warn(message: &str, fields: Value) {
    emit(Level::Warn, message, fields);
}

pub fn error(message: &str, fields: Value) {
    emit(Level::Error, message, fields);
}

pub fn emit_forwarded(value: Value) {
    if let Some(logger) = global() {
        logger.emit_forwarded(value);
    }
}

pub fn flush() {
    if let Some(logger) = global() {
        logger.flush();
    }
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: these build Loggers against throwaway databases and call
// their private emit methods; the only public seam is the process-global logger, which can be
// installed once per process. The module's pure helpers live in tests/logging.rs.
#[path = "../tests/unit/logging.rs"]
mod tests;
