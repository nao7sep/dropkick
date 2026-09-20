// Per-session JSON Lines logger. The privileged Rust core owns the log file;
// the sandboxed webview frontend forwards structured log objects to it (see
// `emit_forwarded` and the `log_event` command in lib.rs). This module is the
// reference logger for our Tauri apps — keep it self-contained and dependency-free.
//
// Design (mirrors ~/code/company/conventions/...-logging-conventions.md):
//   - One file per process launch: ~/.dropkick/logs/<yyyymmdd-hhmmss-fff-utc.log>.
//     Strictly that stamp — no pid or id suffix. Two launches in the same UTC
//     millisecond collide on the name; the file is opened with exclusive
//     create, so the second launch's open fails and it degrades to the
//     stderr fallback rather than interleaving two sessions into one file.
//   - One JSON object per line: { time, level, message, ...fields }.
//   - `time` is UTC ISO 8601 with milliseconds and `Z`, generated here without a
//     date crate (no new heavy deps) via a hand-rolled civil-time conversion.
//   - Four levels. `debug` is developer-only and never written unless the debug
//     gate is on (a dev build, or DROPKICK_DEBUG=1).
//   - Every line is written straight through to the OS (unbuffered), so the
//     convention's "last lines before a crash must reach disk" holds for free:
//     once a line is logged the OS has it, surviving a panic, SIGKILL, or any
//     signal — no buffer can strand it, and there is no flush to forget. (Log
//     volume is human-paced and IO-bounded, so per-line writes cost nothing
//     meaningful; only a kernel panic or power loss, which no userspace flush
//     would prevent either, can lose an unsynced page.)
//   - A mandatory, non-destructive redactor replaces the value of any field whose
//     name (exact, case-insensitive) is in the denied set; it never edits prose.
//   - If the file cannot be opened or written, it degrades to stderr and never
//     panics — the app must never crash because logging failed. A mid-session
//     write failure permanently switches to the stderr fallback (the dead
//     handle is dropped and never retried), and the line that failed to write
//     is re-emitted to stderr so its content is never lost.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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

// `<yyyymmdd-hhmmss-fff-utc.log>` for the current launch — the plain UTC stamp
// (with milliseconds) and no other suffix; a same-millisecond collision is
// accepted rather than engineered around.
pub fn session_filename() -> String {
    format!("{}.log", filename_stamp(now_unix_millis()))
}

// The bare filename stamp for other derived-sibling names that carry a moment
// discriminator (a quarantined store's `<stem>-<stamp>.invalid`) — the same
// formatter as the session log name, so there is exactly one filename stamp.
pub fn filename_stamp_now() -> String {
    filename_stamp(now_unix_millis())
}

// --- Redaction: non-destructive, key-name based, recursive, total ---

pub fn default_denied() -> HashSet<String> {
    ["apikey", "authorization", "token", "password", "secret"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

// Replaces the value of any field whose key (lowercased) is denied with the
// fixed marker; recurses into objects and arrays. Never inspects string content,
// never edits `message` (it is not a denied key), cannot drop fields or throw.
pub fn redact_in_place(value: &mut Value, denied: &HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if denied.contains(&key.to_ascii_lowercase()) {
                    *child = Value::String("[redacted]".to_string());
                } else {
                    redact_in_place(child, denied);
                }
            }
        }
        Value::Array(items) => {
            for child in items.iter_mut() {
                redact_in_place(child, denied);
            }
        }
        _ => {}
    }
}

// --- The logger itself ---

struct Inner {
    // Unbuffered: each line is written straight to the file so a crash or signal
    // can never strand buffered lines. `None` means file logging failed at open
    // and we degrade to stderr.
    writer: Option<File>,
}

pub struct Logger {
    inner: Mutex<Inner>,
    debug_enabled: bool,
    denied: HashSet<String>,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

// Opens the session file (creating ~/.dropkick/logs/ if needed) and installs the
// process-global logger. On any failure it installs a logger that writes to
// stderr instead, so logging calls always have somewhere to go. Call once.
pub fn init(file_path: &Path, debug_enabled: bool) {
    let writer = open_writer(file_path);
    let logger = Logger {
        inner: Mutex::new(Inner { writer }),
        debug_enabled,
        denied: default_denied(),
    };
    if LOGGER.set(logger).is_err() {
        eprintln!("[dropkick:logging] logger already initialized; ignoring re-init");
    }
}

fn open_writer(file_path: &Path) -> Option<File> {
    if let Some(parent) = file_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!(
                "[dropkick:logging] could not create {}: {e}; logging to stderr",
                parent.display()
            );
            return None;
        }
    }
    // Exclusive create: a session file is always fresh, never appended into.
    // Two launches landing on the same millisecond stamp are the one case this
    // can legitimately fail on live filesystems; the second one loses the race
    // and falls through to the stderr fallback below rather than interleaving
    // both sessions into a single file.
    match OpenOptions::new().create_new(true).write(true).open(file_path) {
        Ok(file) => Some(file),
        Err(e) => {
            eprintln!(
                "[dropkick:logging] could not open {}: {e}; logging to stderr",
                file_path.display()
            );
            None
        }
    }
}

fn global() -> Option<&'static Logger> {
    LOGGER.get()
}

pub fn debug_enabled() -> bool {
    global().map(|l| l.debug_enabled).unwrap_or(false)
}

impl Logger {
    // Redacts, serializes, and writes one envelope as a single line. Both emit()
    // and emit_forwarded() funnel through here, so every line in the file passes
    // the identical redact + write contract.
    fn write_envelope(&self, obj: Map<String, Value>) {
        let mut value = Value::Object(obj);
        redact_in_place(&mut value, &self.denied);
        let mut line = match serde_json::to_string(&value) {
            Ok(line) => line,
            Err(e) => {
                eprintln!("[dropkick:logging] serialize failed: {e}");
                return;
            }
        };
        line.push('\n');
        // Recover from a poisoned mutex: a prior panic-while-writing must not
        // wedge logging shut, least of all the panic hook trying to record it.
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        match inner.writer.as_mut() {
            // One write_all per line; the file is opened via exclusive create
            // and this is the only writer in the process, so lines never
            // interleave. The bytes reach the OS immediately — no buffer,
            // nothing to flush.
            Some(writer) => {
                if let Err(e) = writer.write_all(line.as_bytes()) {
                    // The handle is dead (disk full, permissions revoked, the
                    // device went away). Never retry it: drop it permanently so
                    // every later call takes the `None` branch below, and
                    // re-emit this very line to stderr right now so its content
                    // is degraded-to, not silently swallowed.
                    eprintln!(
                        "[dropkick:logging] write failed: {e}; switching to stderr fallback"
                    );
                    inner.writer = None;
                    eprint!("{line}");
                }
            }
            None => eprint!("{line}"),
        }
    }

    // Builds the envelope from a Rust-side event and writes it. `fields` is
    // merged in; the envelope keys (time/level/message) always win.
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
        self.write_envelope(obj);
    }

    // Writes an object the frontend already shaped (it stamped `time` at the
    // event instant). We re-apply the debug gate and the redactor so every line
    // in the file went through the same writer contract.
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
        self.write_envelope(obj);
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

#[cfg(test)]
// EXCEPTION to tests-folder conventions: these exercise the Logger's own internals, building a
// Logger around an injected file handle and asserting on `inner.writer` after a failed write; no
// public seam reaches that without exposing `Inner` and its fields purely for tests. The module's
// pure helpers live in tests/logging.rs.
#[path = "../tests/unit/logging.rs"]
mod tests;
