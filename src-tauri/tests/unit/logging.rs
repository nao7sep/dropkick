use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU32, Ordering};

fn temp_dir() -> PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "dropkick-log-test-{}-{}",
        std::process::id(),
        n
    ));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

fn temp_logger(debug_enabled: bool) -> (Logger, PathBuf) {
    let dir = temp_dir();
    let logger = Logger::open(&dir.join("records.sqlite3"), &dir.join("logs"), debug_enabled);
    assert!(logger.records.lock().unwrap().is_ok(), "temp records database should open");
    (logger, dir)
}

struct Row {
    time: String,
    session: String,
    level: String,
    message: String,
    task_id: Option<String>,
    fields: Value,
}

fn rows(dir: &Path) -> Vec<Row> {
    let conn = Connection::open(dir.join("records.sqlite3")).expect("open records");
    let mut statement = conn
        .prepare("SELECT time, session, level, message, task_id, fields FROM logs ORDER BY id")
        .expect("prepare");
    statement
        .query_map([], |row| {
            Ok(Row {
                time: row.get(0)?,
                session: row.get(1)?,
                level: row.get(2)?,
                message: row.get(3)?,
                task_id: row.get(4)?,
                fields: serde_json::from_str(&row.get::<_, String>(5)?).expect("fields are JSON"),
            })
        })
        .expect("query")
        .map(|row| row.expect("row"))
        .collect()
}

fn fallback_lines(logger: &Logger) -> Vec<Value> {
    std::fs::read_to_string(&logger.fallback_file)
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).expect("each fallback line is valid JSON"))
        .collect()
}

#[test]
fn entry_is_a_row_with_its_session_as_soon_as_it_is_logged() {
    let (logger, dir) = temp_logger(false);
    logger.emit(Level::Info, "started", json!({ "n": 3 }));
    let rows = rows(&dir);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].level, "info");
    assert_eq!(rows[0].message, "started");
    assert_eq!(rows[0].fields, json!({ "n": 3 }));
    assert_eq!(rows[0].session, logger.session);
    assert!(rows[0].time.ends_with('Z'));
    assert!(rows[0].session.ends_with('Z'));
}

#[test]
fn a_task_id_is_its_own_column() {
    let (logger, dir) = temp_logger(false);
    logger.emit_forwarded(json!({
        "time": "2026-06-10T03:15:42.123Z",
        "level": "info",
        "message": "update task title",
        "file": "/tasks.json",
        "taskId": "t1",
    }));
    let rows = rows(&dir);
    assert_eq!(rows[0].task_id.as_deref(), Some("t1"));
    assert_eq!(rows[0].fields, json!({ "file": "/tasks.json" }));
    assert_eq!(rows[0].time, "2026-06-10T03:15:42.123Z");
}

#[test]
fn a_non_string_envelope_value_is_kept_in_fields() {
    let (logger, dir) = temp_logger(false);
    logger.emit_forwarded(json!({ "message": 7, "taskId": 9 }));
    let rows = rows(&dir);
    assert_eq!(rows[0].message, "");
    assert_eq!(rows[0].task_id, None);
    assert_eq!(rows[0].fields, json!({ "message": 7, "taskId": 9 }));
}

#[test]
fn nested_error_message_is_preserved_as_a_field() {
    let (logger, dir) = temp_logger(false);
    logger.emit(
        Level::Warn,
        "read failed",
        json!({ "path": "/x.json", "error": { "message": "bad json" } }),
    );
    let rows = rows(&dir);
    assert_eq!(rows[0].message, "read failed");
    assert_eq!(rows[0].fields["error"], json!({ "message": "bad json" }));
}

#[test]
fn rust_debug_is_dropped_when_the_gate_is_off() {
    let (logger, dir) = temp_logger(false);
    logger.emit(Level::Debug, "noise", json!({}));
    assert!(rows(&dir).is_empty());
}

#[test]
fn forwarded_unknown_level_is_normalized_to_the_gated_level() {
    // A forwarded level Level::parse cannot recognize is written as the level
    // we actually gated/handled it as (info), never kept verbatim.
    let (logger, dir) = temp_logger(false);
    logger.emit_forwarded(json!({
        "time": "2026-06-10T03:15:42.123Z",
        "level": "warning",
        "message": "odd",
    }));
    let rows = rows(&dir);
    assert_eq!(rows[0].level, "info");
    assert_eq!(rows[0].message, "odd");
    // The frontend's own event time is preserved.
    assert_eq!(rows[0].time, "2026-06-10T03:15:42.123Z");
}

#[test]
fn forwarded_missing_envelope_fields_are_filled() {
    let (logger, dir) = temp_logger(false);
    logger.emit_forwarded(json!({ "detail": 1 }));
    let rows = rows(&dir);
    assert_eq!(rows[0].level, "info");
    assert_eq!(rows[0].message, "");
    assert!(rows[0].time.ends_with('Z'));
    assert_eq!(rows[0].fields, json!({ "detail": 1 }));
}

#[test]
fn forwarded_debug_respects_the_gate() {
    let (off, off_dir) = temp_logger(false);
    off.emit_forwarded(json!({ "level": "debug", "message": "frame" }));
    assert!(rows(&off_dir).is_empty());

    let (on, on_dir) = temp_logger(true);
    on.emit_forwarded(json!({ "level": "debug", "message": "frame" }));
    assert_eq!(rows(&on_dir)[0].level, "debug");
}

#[test]
fn forwarded_warn_keeps_its_level() {
    let (logger, dir) = temp_logger(false);
    logger.emit_forwarded(json!({ "level": "warn", "message": "careful" }));
    assert_eq!(rows(&dir)[0].level, "warn");
}

#[test]
fn an_unopenable_database_sends_each_entry_to_the_session_fallback_file() {
    let dir = temp_dir();
    std::fs::create_dir_all(&dir).expect("create temp dir");
    // A directory where the database file should be cannot be opened as one.
    std::fs::create_dir_all(dir.join("records.sqlite3")).expect("block the database path");
    let logger = Logger::open(&dir.join("records.sqlite3"), &dir.join("logs"), false);

    logger.emit(Level::Warn, "first", json!({ "n": 1 }));
    logger.emit(Level::Info, "second", json!({}));

    assert!(logger.fallback_file.starts_with(dir.join("logs")));
    let name = logger.fallback_file.file_name().unwrap().to_str().unwrap();
    assert!(name.ends_with("-utc.log"), "fallback file {name} is named for the session");
    let lines = fallback_lines(&logger);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["message"], json!("first"));
    assert_eq!(lines[0]["n"], json!(1));
    assert!(lines[0]["recordsError"].as_str().is_some_and(|e| !e.is_empty()));
    assert_eq!(lines[1]["message"], json!("second"));
}

#[test]
fn a_failed_insert_falls_back_for_that_entry_only() {
    let (logger, dir) = temp_logger(false);
    logger.emit(Level::Info, "before", json!({}));
    logger
        .records
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .execute_batch("ALTER TABLE logs RENAME TO moved")
        .expect("break the table");
    logger.emit(Level::Error, "during", json!({}));
    logger
        .records
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .execute_batch("ALTER TABLE moved RENAME TO logs")
        .expect("restore the table");
    logger.emit(Level::Info, "after", json!({}));

    let messages: Vec<String> = rows(&dir).into_iter().map(|row| row.message).collect();
    assert_eq!(messages, ["before", "after"]);
    let lines = fallback_lines(&logger);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["message"], json!("during"));
}

#[test]
fn the_writer_thread_writes_entries_in_the_order_they_were_logged() {
    let (logger, dir) = temp_logger(false);
    let logger: &'static Logger = Box::leak(Box::new(logger));
    logger.start_writer();
    for n in 0..50 {
        logger.emit(Level::Warn, "queued", json!({ "n": n }));
    }
    logger.emit_forwarded(json!({ "level": "info", "message": "forwarded" }));
    logger.flush();
    let rows = rows(&dir);
    assert_eq!(rows.len(), 51);
    for (n, row) in rows.iter().take(50).enumerate() {
        assert_eq!(row.fields, json!({ "n": n }));
    }
    assert_eq!(rows[50].message, "forwarded");
}
