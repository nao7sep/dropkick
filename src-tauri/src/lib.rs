use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

mod logging;

// --- Command boundary logging ---
//
// Each command logs its start and result at `debug` (the low-level IPC/FS
// firehose, silent in release) and any failure at `error`. The human-readable
// `info` record for each logical operation lives one layer up, on the frontend
// repository/service that issued the call — so a single operation is never
// double-counted at `info`.

fn merge_command(command: &str, started: Option<Instant>, fields: Value) -> Value {
    let mut map = match fields {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    map.insert("command".to_string(), Value::String(command.to_string()));
    if let Some(started) = started {
        map.insert(
            "ms".to_string(),
            json!(started.elapsed().as_millis() as u64),
        );
    }
    Value::Object(map)
}

fn log_cmd_start(command: &str, fields: Value) -> Instant {
    logging::debug("command start", merge_command(command, None, fields));
    Instant::now()
}

fn log_cmd_ok(command: &str, started: Instant, fields: Value) {
    logging::debug("command ok", merge_command(command, Some(started), fields));
}

fn log_cmd_err(command: &str, started: Instant, message: impl Into<String>) {
    let mut value = merge_command(command, Some(started), Value::Null);
    if let Value::Object(map) = &mut value {
        map.insert("error".to_string(), json!({ "message": message.into() }));
    }
    logging::error("command error", value);
}

// Records the panic payload, location, and (when RUST_BACKTRACE is set) the
// backtrace, flushes, then defers to the previous hook so the process still
// aborts and prints as usual.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "non-string panic payload".to_string()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        let backtrace = std::backtrace::Backtrace::capture();
        logging::error(
            "panic",
            json!({
                "error": {
                    "message": payload,
                    "location": location,
                    "backtrace": format!("{backtrace}"),
                }
            }),
        );
        // The error line is already on disk (the logger is unbuffered); defer to
        // the previous hook so the process still aborts and prints as usual.
        default_hook(info);
    }));
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDto {
    id: String,
    content: String,
    actionability: String,
    created_at_utc: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDto {
    id: String,
    title: String,
    description: String,
    status: String,
    priority: String,
    due_date: Option<String>,
    created_at_utc: String,
    updated_at_utc: String,
    completed_at_utc: Option<String>,
    notes: Vec<NoteDto>,
}

#[derive(Deserialize, Serialize)]
struct TaskListDto {
    version: String,
    tasks: Vec<TaskDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum JsonFileWithHashResult {
    Success { data: TaskListDto, hash: String },
    Missing,
    Invalid { message: String },
    Error { message: String },
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

// Computes SHA-256 hash of a file's raw bytes.
// Called from TypeScript before every write to detect external modifications.
#[tauri::command]
fn hash_file(path: &str) -> Result<String, String> {
    let started = log_cmd_start("hash_file", json!({ "path": path }));
    match std::fs::read(path) {
        Ok(bytes) => {
            let hash = sha256_hex(&bytes);
            log_cmd_ok(
                "hash_file",
                started,
                json!({ "path": path, "bytes": bytes.len() }),
            );
            Ok(hash)
        }
        Err(e) => {
            log_cmd_err("hash_file", started, e.to_string());
            Err(e.to_string())
        }
    }
}

// Reads a JSON file once, parses it, and returns an explicit result with a
// hash of the exact bytes that were read.
#[tauri::command]
fn read_json_file_with_hash(path: &str) -> Result<JsonFileWithHashResult, String> {
    let started = log_cmd_start("read_json_file_with_hash", json!({ "path": path }));
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log_cmd_ok(
                "read_json_file_with_hash",
                started,
                json!({ "path": path, "outcome": "missing" }),
            );
            return Ok(JsonFileWithHashResult::Missing);
        }
        Err(err) => {
            log_cmd_ok(
                "read_json_file_with_hash",
                started,
                json!({ "path": path, "outcome": "error", "error": { "message": err.to_string() } }),
            );
            return Ok(JsonFileWithHashResult::Error {
                message: err.to_string(),
            });
        }
    };

    let data = match serde_json::from_slice::<TaskListDto>(&bytes) {
        Ok(data) => data,
        Err(err) => {
            log_cmd_ok(
                "read_json_file_with_hash",
                started,
                json!({ "path": path, "bytes": bytes.len(), "outcome": "invalid", "error": { "message": err.to_string() } }),
            );
            return Ok(JsonFileWithHashResult::Invalid {
                message: err.to_string(),
            });
        }
    };
    let tasks = data.tasks.len();
    let hash = sha256_hex(&bytes);
    log_cmd_ok(
        "read_json_file_with_hash",
        started,
        json!({ "path": path, "bytes": bytes.len(), "tasks": tasks, "outcome": "success" }),
    );
    Ok(JsonFileWithHashResult::Success { data, hash })
}

// Creates a zip backup from a list of (zip_entry_name, content) pairs.
// The frontend reads each source file inside its per-path serial slot (see
// withSerial in file-system.ts) so the bytes here are guaranteed to be a
// coherent snapshot of one file at one moment — never mid-write.
// Returns the path to the created zip file.
#[tauri::command]
fn create_backup_from_entries(
    entries: Vec<(String, String)>,
    output_path: String,
) -> Result<String, String> {
    let total_bytes: usize = entries.iter().map(|(_, content)| content.len()).sum();
    let started = log_cmd_start(
        "create_backup_from_entries",
        json!({ "outputPath": output_path, "entries": entries.len(), "bytes": total_bytes }),
    );

    let result = (|| -> Result<String, String> {
        // Ensure parent directory exists.
        if let Some(parent) = std::path::Path::new(&output_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }

        let file = std::fs::File::create(&output_path)
            .map_err(|e| format!("Failed to create backup file: {}", e))?;
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        for (entry_name, content) in &entries {
            zip.start_file(entry_name, options)
                .map_err(|e| format!("Failed to add {} to zip: {}", entry_name, e))?;
            std::io::Write::write_all(&mut zip, content.as_bytes())
                .map_err(|e| format!("Failed to write {} to zip: {}", entry_name, e))?;
        }

        zip.finish()
            .map_err(|e| format!("Failed to finalize zip: {}", e))?;
        Ok(output_path.clone())
    })();

    match &result {
        Ok(path) => log_cmd_ok(
            "create_backup_from_entries",
            started,
            json!({ "outputPath": path, "entries": entries.len(), "bytes": total_bytes }),
        ),
        Err(message) => log_cmd_err("create_backup_from_entries", started, message.clone()),
    }
    result
}

// Lists files in a directory, returning their names.
// Used by the frontend to enumerate existing backups for pruning.
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let started = log_cmd_start("list_directory", json!({ "path": path }));
    let dir = match std::fs::read_dir(&path) {
        Ok(d) => d,
        Err(_) => {
            // Directory doesn't exist yet — that's fine.
            log_cmd_ok(
                "list_directory",
                started,
                json!({ "path": path, "count": 0, "outcome": "missing" }),
            );
            return Ok(vec![]);
        }
    };

    let mut names: Vec<String> = Vec::new();
    for entry in dir.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    log_cmd_ok(
        "list_directory",
        started,
        json!({ "path": path, "count": names.len() }),
    );
    Ok(names)
}

// Deletes a file. Used to prune old backups.
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let started = log_cmd_start("delete_file", json!({ "path": path }));
    match std::fs::remove_file(&path) {
        Ok(()) => {
            log_cmd_ok("delete_file", started, json!({ "path": path }));
            Ok(())
        }
        Err(e) => {
            let message = format!("Failed to delete {}: {}", path, e);
            log_cmd_err("delete_file", started, message.clone());
            Err(message)
        }
    }
}

// Generic text read with an explicit missing/success/error union — the
// non-task-list counterpart to read_json_file_with_hash. Moving plain reads here
// (alongside writes/exists/mkdir below) is what lets the webview drop the Tauri
// fs plugin and its broad `$HOME/**` scope: the Rust core reaches the user's
// chosen files directly, so a compromised renderer cannot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum TextReadResult {
    Success { text: String },
    Missing,
    Error { message: String },
}

#[tauri::command]
fn read_text_file(path: &str) -> Result<TextReadResult, String> {
    let started = log_cmd_start("read_text_file", json!({ "path": path }));
    match std::fs::read_to_string(path) {
        Ok(text) => {
            log_cmd_ok(
                "read_text_file",
                started,
                json!({ "path": path, "bytes": text.len(), "outcome": "success" }),
            );
            Ok(TextReadResult::Success { text })
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            log_cmd_ok(
                "read_text_file",
                started,
                json!({ "path": path, "outcome": "missing" }),
            );
            Ok(TextReadResult::Missing)
        }
        Err(err) => {
            log_cmd_ok(
                "read_text_file",
                started,
                json!({ "path": path, "outcome": "error", "error": { "message": err.to_string() } }),
            );
            Ok(TextReadResult::Error {
                message: err.to_string(),
            })
        }
    }
}

// Atomic write: write to a temp file in the same directory, fsync it, then
// rename over the target (and fsync the directory) so a crash or power loss can
// never leave a half-written task/config file — the renamed-in file is either
// the old bytes or the complete new bytes. The parent directory must already
// exist (callers ensure_dir first), matching the previous plugin behavior.
#[tauri::command]
fn write_text_file_atomic(path: &str, contents: &str) -> Result<(), String> {
    let started = log_cmd_start(
        "write_text_file_atomic",
        json!({ "path": path, "bytes": contents.len() }),
    );
    let result = write_atomic(path, contents);
    match &result {
        Ok(()) => log_cmd_ok(
            "write_text_file_atomic",
            started,
            json!({ "path": path, "bytes": contents.len() }),
        ),
        Err(message) => log_cmd_err("write_text_file_atomic", started, message.clone()),
    }
    result
}

fn write_atomic(path: &str, contents: &str) -> Result<(), String> {
    use std::io::Write;
    let target = std::path::Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;
    let tmp = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    let write_tmp = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_tmp {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    // Best-effort: persist the rename itself by fsyncing the directory.
    if let Ok(dir) = std::fs::File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

#[tauri::command]
fn file_exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

#[tauri::command]
fn ensure_dir(path: &str) -> Result<(), String> {
    let started = log_cmd_start("ensure_dir", json!({ "path": path }));
    match std::fs::create_dir_all(path) {
        Ok(()) => {
            log_cmd_ok("ensure_dir", started, json!({ "path": path }));
            Ok(())
        }
        Err(e) => {
            let message = e.to_string();
            log_cmd_err("ensure_dir", started, message.clone());
            Err(message)
        }
    }
}

// Receives a structured log object from the webview frontend and writes it to
// the session file (the frontend has no filesystem access of its own).
#[tauri::command]
fn log_event(entry: Value) {
    logging::emit_forwarded(entry);
}

// Reports whether developer-only `debug` logging is on, so the frontend can
// gate its own debug events identically (a dev build, or DROPKICK_DEBUG=1).
#[tauri::command]
fn logging_debug_enabled() -> bool {
    logging::debug_enabled()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Unique temp directory per call so parallel tests never collide.
    fn unique_temp_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "dropkick-test-{}-{}-{}",
            label,
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sha256_hex_matches_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_file_hashes_actual_bytes() {
        let dir = unique_temp_dir("hash");
        let path = dir.join("f.txt");
        std::fs::write(&path, b"abc").unwrap();
        let result = hash_file(path.to_str().unwrap()).unwrap();
        assert_eq!(result, sha256_hex(b"abc"));
    }

    #[test]
    fn read_json_returns_missing_for_absent_file() {
        let dir = unique_temp_dir("read-missing");
        let path = dir.join("nope.json");
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        assert!(matches!(result, JsonFileWithHashResult::Missing));
    }

    #[test]
    fn read_json_returns_invalid_for_bad_json() {
        let dir = unique_temp_dir("read-invalid");
        let path = dir.join("bad.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        assert!(matches!(result, JsonFileWithHashResult::Invalid { .. }));
    }

    #[test]
    fn read_json_returns_success_with_hash() {
        let dir = unique_temp_dir("read-success");
        let path = dir.join("good.json");
        let json = br#"{"version":"1.0.0","tasks":[]}"#;
        std::fs::write(&path, json).unwrap();
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        match result {
            JsonFileWithHashResult::Success { data, hash } => {
                assert_eq!(data.version, "1.0.0");
                assert!(data.tasks.is_empty());
                assert_eq!(hash, sha256_hex(json));
            }
            other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
        }
    }

    #[test]
    fn create_backup_writes_a_readable_zip() {
        let dir = unique_temp_dir("backup");
        let output = dir.join("nested").join("backup.zip");
        let entries = vec![
            ("tasks.json".to_string(), "hello".to_string()),
            ("prefs.json".to_string(), "world".to_string()),
        ];
        let returned =
            create_backup_from_entries(entries, output.to_str().unwrap().to_string()).unwrap();
        assert_eq!(returned, output.to_str().unwrap());
        // Parent directory was created and the file exists.
        assert!(output.exists());

        // Read the zip back and verify both entries and their contents.
        let f = std::fs::File::open(&output).unwrap();
        let mut archive = zip::ZipArchive::new(f).unwrap();
        assert_eq!(archive.len(), 2);

        let mut tasks = String::new();
        archive
            .by_name("tasks.json")
            .unwrap()
            .read_to_string(&mut tasks)
            .unwrap();
        assert_eq!(tasks, "hello");

        let mut prefs = String::new();
        archive
            .by_name("prefs.json")
            .unwrap()
            .read_to_string(&mut prefs)
            .unwrap();
        assert_eq!(prefs, "world");
    }

    #[test]
    fn list_directory_returns_empty_for_missing_dir() {
        let dir = unique_temp_dir("list-missing");
        let missing = dir.join("does-not-exist");
        let result = list_directory(missing.to_str().unwrap().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn list_directory_returns_sorted_names() {
        let dir = unique_temp_dir("list");
        std::fs::write(dir.join("c.txt"), b"").unwrap();
        std::fs::write(dir.join("a.txt"), b"").unwrap();
        std::fs::write(dir.join("b.txt"), b"").unwrap();
        let result = list_directory(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(result, vec!["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn delete_file_removes_the_file() {
        let dir = unique_temp_dir("delete");
        let path = dir.join("gone.txt");
        std::fs::write(&path, b"x").unwrap();
        assert!(path.exists());
        delete_file(path.to_str().unwrap().to_string()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_errors_for_missing_file() {
        let dir = unique_temp_dir("delete-missing");
        let path = dir.join("nope.txt");
        assert!(delete_file(path.to_str().unwrap().to_string()).is_err());
    }

    #[test]
    fn read_text_file_returns_missing_success_states() {
        let dir = unique_temp_dir("read-text");
        let missing = dir.join("nope.txt");
        assert!(matches!(
            read_text_file(missing.to_str().unwrap()).unwrap(),
            TextReadResult::Missing
        ));

        let path = dir.join("f.txt");
        std::fs::write(&path, "héllo\nworld").unwrap();
        match read_text_file(path.to_str().unwrap()).unwrap() {
            TextReadResult::Success { text } => assert_eq!(text, "héllo\nworld"),
            other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
        }
    }

    #[test]
    fn write_text_file_atomic_writes_and_replaces() {
        let dir = unique_temp_dir("write-atomic");
        let path = dir.join("f.json");
        let p = path.to_str().unwrap();

        write_text_file_atomic(p, "first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");

        // Overwriting replaces the content atomically (rename over existing).
        write_text_file_atomic(p, "second longer contents").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second longer contents");

        // No stray temp files left behind in the directory.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
    }

    #[test]
    fn write_text_file_atomic_errors_when_parent_missing() {
        let dir = unique_temp_dir("write-no-parent");
        let path = dir.join("missing-subdir").join("f.json");
        assert!(write_text_file_atomic(path.to_str().unwrap(), "x").is_err());
    }

    #[test]
    fn file_exists_reflects_presence() {
        let dir = unique_temp_dir("exists");
        let path = dir.join("f.txt");
        assert!(!file_exists(path.to_str().unwrap()));
        std::fs::write(&path, b"x").unwrap();
        assert!(file_exists(path.to_str().unwrap()));
    }

    #[test]
    fn ensure_dir_creates_nested_and_is_idempotent() {
        let dir = unique_temp_dir("ensure");
        let nested = dir.join("a").join("b").join("c");
        let p = nested.to_str().unwrap();
        ensure_dir(p).unwrap();
        assert!(nested.is_dir());
        // Idempotent: calling again on an existing dir is fine.
        ensure_dir(p).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Developer-only `debug` logging: on for a dev build, or when explicitly
    // requested via DROPKICK_DEBUG=1. Off (and compiled-quiet) in release.
    let debug_enabled = cfg!(debug_assertions)
        || std::env::var("DROPKICK_DEBUG")
            .map(|v| v == "1")
            .unwrap_or(false);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // Open the per-session log file under the app's own data dir. The Rust
            // core has filesystem access even though the webview is sandboxed.
            let home = app
                .path()
                .home_dir()
                .map_err(|e| format!("could not resolve home directory: {e}"))?;
            let log_path = home
                .join(".dropkick")
                .join("logs")
                .join(logging::session_filename());
            logging::init(&log_path, debug_enabled);
            install_panic_hook();

            logging::info(
                "app startup",
                json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "build": if cfg!(debug_assertions) { "debug" } else { "release" },
                    "debugLogging": debug_enabled,
                    "logPath": log_path.to_string_lossy(),
                    "os": std::env::consts::OS,
                    "arch": std::env::consts::ARCH,
                }),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hash_file,
            read_json_file_with_hash,
            read_text_file,
            write_text_file_atomic,
            file_exists,
            ensure_dir,
            create_backup_from_entries,
            list_directory,
            delete_file,
            log_event,
            logging_debug_enabled
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            logging::info("app shutdown", json!({ "reason": "exit" }));
        }
    });
}
