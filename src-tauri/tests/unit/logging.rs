use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicU32, Ordering};

fn temp_logger(debug_enabled: bool) -> (Logger, std::path::PathBuf) {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "dropkick-log-test-{}-{}.log",
        std::process::id(),
        n
    ));
    let _ = std::fs::remove_file(&path);
    let writer = open_writer(&path);
    assert!(writer.is_some(), "temp log file should open");
    let logger = Logger {
        inner: Mutex::new(Inner { writer }),
        debug_enabled,
        denied: default_denied(),
    };
    (logger, path)
}

fn read_lines(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str::<Value>(l).expect("each log line is valid JSON"))
        .collect()
}

#[test]
fn line_is_on_disk_immediately_without_an_explicit_flush() {
    // The logger is unbuffered: a line is readable right after emit with no
    // flush call — this is what makes it survive a crash or signal.
    let (logger, path) = temp_logger(false);
    logger.emit(Level::Info, "started", json!({ "n": 3 }));
    let lines = read_lines(&path);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["level"], json!("info"));
    assert_eq!(lines[0]["message"], json!("started"));
    assert_eq!(lines[0]["n"], json!(3));
    assert!(lines[0]["time"].as_str().unwrap().ends_with('Z'));
}

#[test]
fn redaction_applies_to_the_written_line() {
    let (logger, path) = temp_logger(false);
    logger.emit(
        Level::Info,
        "creds",
        json!({ "apiKey": "sk-secret", "count": 1 }),
    );
    let lines = read_lines(&path);
    assert_eq!(lines[0]["apiKey"], json!("[redacted]"));
    assert_eq!(lines[0]["count"], json!(1));
}

#[test]
fn nested_error_message_is_preserved_as_a_field() {
    let (logger, path) = temp_logger(false);
    logger.emit(
        Level::Warn,
        "read failed",
        json!({ "path": "/x.json", "error": { "message": "bad json" } }),
    );
    let lines = read_lines(&path);
    assert_eq!(lines[0]["message"], json!("read failed"));
    assert_eq!(lines[0]["error"], json!({ "message": "bad json" }));
}

#[test]
fn rust_debug_is_dropped_when_the_gate_is_off() {
    let (logger, path) = temp_logger(false);
    logger.emit(Level::Debug, "noise", json!({}));
    assert!(read_lines(&path).is_empty());
}

#[test]
fn forwarded_unknown_level_is_normalized_to_the_gated_level() {
    // A forwarded level Level::parse cannot recognize is written as the level
    // we actually gated/handled it as (info), never kept verbatim.
    let (logger, path) = temp_logger(false);
    logger.emit_forwarded(json!({
        "time": "2026-06-10T03:15:42.123Z",
        "level": "warning",
        "message": "odd",
    }));
    let lines = read_lines(&path);
    assert_eq!(lines[0]["level"], json!("info"));
    assert_eq!(lines[0]["message"], json!("odd"));
    // The frontend's own event time is preserved.
    assert_eq!(lines[0]["time"], json!("2026-06-10T03:15:42.123Z"));
}

#[test]
fn forwarded_missing_envelope_fields_are_filled() {
    let (logger, path) = temp_logger(false);
    logger.emit_forwarded(json!({ "detail": 1 }));
    let lines = read_lines(&path);
    assert_eq!(lines[0]["level"], json!("info"));
    assert_eq!(lines[0]["message"], json!(""));
    assert!(lines[0]["time"].as_str().unwrap().ends_with('Z'));
    assert_eq!(lines[0]["detail"], json!(1));
}

#[test]
fn forwarded_debug_respects_the_gate() {
    let (off, off_path) = temp_logger(false);
    off.emit_forwarded(json!({ "level": "debug", "message": "frame" }));
    assert!(read_lines(&off_path).is_empty());

    let (on, on_path) = temp_logger(true);
    on.emit_forwarded(json!({ "level": "debug", "message": "frame" }));
    assert_eq!(read_lines(&on_path)[0]["level"], json!("debug"));
}

#[test]
fn forwarded_warn_keeps_its_level() {
    let (logger, path) = temp_logger(false);
    logger.emit_forwarded(json!({ "level": "warn", "message": "careful" }));
    assert_eq!(read_lines(&path)[0]["level"], json!("warn"));
}

// --- Exclusive create: same-path second open degrades to the fallback ---

#[test]
fn exclusive_create_second_open_of_same_path_falls_back_to_stderr() {
    let path = std::env::temp_dir().join(format!(
        "dropkick-log-test-exclusive-{}.log",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);

    let first = open_writer(&path);
    assert!(first.is_some(), "the first open should create the file exclusively");

    // A second open of the exact same path (the same-millisecond-clash case
    // in practice) must not append into or truncate the first session's
    // file — `create_new` makes it fail outright, and `open_writer` turns
    // that failure into the `None` stderr-fallback sentinel.
    let second = open_writer(&path);
    assert!(
        second.is_none(),
        "a same-path second open must fail over to the stderr fallback, not interleave"
    );

    let _ = std::fs::remove_file(&path);
}

// --- Mid-session write failure: permanent fallback, dead handle dropped ---

#[test]
fn write_failure_permanently_falls_back_and_stops_touching_the_dead_handle() {
    // Induce a real, deterministic write failure without abusing fd
    // ownership (closing a live fd out from under an open `File` trips
    // Rust's IO-safety double-close abort on the eventual second close).
    // A file opened read-only is a legitimate, valid handle whose own
    // close() always succeeds — but every write against it genuinely fails
    // at the OS level (EBADF/"access denied"), the same shape `write_all`
    // sees on a real mid-session failure (disk full, permissions revoked).
    let path = std::env::temp_dir().join(format!(
        "dropkick-log-test-write-fail-{}.log",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    std::fs::write(&path, b"").expect("create temp file");
    let readonly = File::open(&path).expect("open temp file read-only");

    let logger = Logger {
        inner: Mutex::new(Inner {
            writer: Some(readonly),
        }),
        debug_enabled: false,
        denied: default_denied(),
    };

    // The failing write must not panic, and must permanently drop the dead
    // handle rather than retry it on the next call.
    logger.emit(Level::Warn, "during-failure", json!({}));
    {
        let inner = logger.inner.lock().unwrap();
        assert!(
            inner.writer.is_none(),
            "a write failure must permanently switch the logger to the stderr fallback"
        );
    }

    // A later line must take the same `None` fallback branch as the failed
    // line rather than retrying the dead handle — provable because the file
    // on disk (never successfully written through the read-only handle)
    // stays empty.
    logger.emit(Level::Info, "after-failure", json!({}));
    assert!(
        read_lines(&path).is_empty(),
        "no line should ever reach the dead (read-only) file handle"
    );

    let _ = std::fs::remove_file(&path);
}
