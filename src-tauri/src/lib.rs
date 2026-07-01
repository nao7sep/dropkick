use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

mod logging;
mod paths;

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
#[serde(rename_all = "camelCase")]
struct TaskListDto {
    version: String,
    // A stable identity materialized on load (see task-list-repository.ts). Legacy
    // files predate the field, so it defaults to empty on read; the frontend fills
    // and persists it. It rides through this struct so read_json_file_with_hash —
    // which returns the deserialized DTO, not the raw text — never strips it.
    #[serde(default)]
    id: String,
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

    let result = classify_json_bytes(&bytes);
    match &result {
        JsonFileWithHashResult::Success { data, .. } => log_cmd_ok(
            "read_json_file_with_hash",
            started,
            json!({ "path": path, "bytes": bytes.len(), "tasks": data.tasks.len(), "outcome": "success" }),
        ),
        JsonFileWithHashResult::Invalid { message } => log_cmd_ok(
            "read_json_file_with_hash",
            started,
            json!({ "path": path, "bytes": bytes.len(), "outcome": "invalid", "error": { "message": message } }),
        ),
        // classify_json_bytes only yields Success or Invalid; Missing/Error are
        // decided by the filesystem read above.
        _ => {}
    }
    Ok(result)
}

// The pure parse/classify half of read_json_file_with_hash: given a file's
// bytes, either parse them into a TaskListDto (Success, with the content hash)
// or report the parse failure (Invalid). No filesystem access, so it is testable
// against in-memory bytes.
fn classify_json_bytes(bytes: &[u8]) -> JsonFileWithHashResult {
    match serde_json::from_slice::<TaskListDto>(bytes) {
        Ok(data) => JsonFileWithHashResult::Success {
            data,
            hash: sha256_hex(bytes),
        },
        Err(err) => JsonFileWithHashResult::Invalid {
            message: err.to_string(),
        },
    }
}

// One file's size and last-modified time (epoch milliseconds). The backup engine
// stats each candidate through this and compares size + mtime against its index
// to decide, without reading content, which files changed since the last archive.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    size: u64,
    mtime_ms: f64,
}

fn read_file_metadata(path: &str) -> Result<FileMetadata, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let mtime_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as f64;
    Ok(FileMetadata {
        size: meta.len(),
        mtime_ms,
    })
}

// Returns a single file's size and mtime. Errors (including a missing file) are
// returned as Err so the backup collector can skip that file best-effort.
#[tauri::command]
fn file_metadata(path: &str) -> Result<FileMetadata, String> {
    let started = log_cmd_start("file_metadata", json!({ "path": path }));
    let result = read_file_metadata(path);
    match &result {
        Ok(m) => log_cmd_ok(
            "file_metadata",
            started,
            json!({ "path": path, "size": m.size, "mtimeMs": m.mtime_ms }),
        ),
        Err(message) => log_cmd_err("file_metadata", started, message.clone()),
    }
    result
}

// One file found under a walked root: its path relative to that root (always
// forward-slash separated, so it maps straight onto a zip entry name), plus size
// and mtime for change detection.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalkedFile {
    relative_path: String,
    size: u64,
    mtime_ms: f64,
}

fn walk_dir(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<WalkedFile>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // Unreadable subtree: skip it, best-effort.
    };
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        // is_dir/is_file are both false for a symlink, so symlinks are skipped —
        // no symlink following, no walk loops.
        if file_type.is_dir() {
            walk_dir(root, &entry.path(), out);
        } else if file_type.is_file() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime_ms = match meta
                .modified()
                .ok()
                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            {
                Some(d) => d.as_millis() as f64,
                None => continue,
            };
            let path = entry.path();
            let relative_path = match path.strip_prefix(root) {
                Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            out.push(WalkedFile {
                relative_path,
                size: meta.len(),
                mtime_ms,
            });
        }
    }
}

// Recursively lists every regular file under `root` with its size and mtime. A
// missing root yields an empty list (first run). Exclusions are applied by the
// backup engine in TypeScript, so this returns everything it can read.
#[tauri::command]
fn list_files_recursive(root: String) -> Result<Vec<WalkedFile>, String> {
    let started = log_cmd_start("list_files_recursive", json!({ "root": root }));
    let mut files = Vec::new();
    let root_path = std::path::Path::new(&root);
    if root_path.exists() {
        walk_dir(root_path, root_path, &mut files);
    }
    log_cmd_ok(
        "list_files_recursive",
        started,
        json!({ "root": root, "count": files.len() }),
    );
    Ok(files)
}

// Writes a zip archive of (entry_name, content) text pairs to `output_path`,
// creating the parent directory if needed. The backup only archives JSON
// documents, so entry contents are UTF-8 text. Entry names are supplied by the
// caller and must already be unique (case-insensitively) — this primitive does
// no path mapping and no de-duplication of its own. Returns the output path.
#[tauri::command]
fn write_zip_archive(entries: Vec<(String, String)>, output_path: String) -> Result<String, String> {
    let total_bytes: usize = entries.iter().map(|(_, content)| content.len()).sum();
    let started = log_cmd_start(
        "write_zip_archive",
        json!({ "outputPath": output_path, "entries": entries.len(), "bytes": total_bytes }),
    );

    let result = (|| -> Result<String, String> {
        if let Some(parent) = std::path::Path::new(&output_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup directory: {}", e))?;
        }
        let bytes = build_zip_bytes(&entries)?;
        // Write to a temp path and rename into place, so the index (written only
        // after this returns) can never come to reference a torn, half-written
        // archive — the rename is atomic on the same filesystem.
        let tmp_path = format!("{}.tmp", output_path);
        std::fs::write(&tmp_path, &bytes)
            .map_err(|e| format!("Failed to write backup file: {}", e))?;
        std::fs::rename(&tmp_path, &output_path)
            .map_err(|e| format!("Failed to finalize backup file: {}", e))?;
        Ok(output_path.clone())
    })();

    match &result {
        Ok(path) => log_cmd_ok(
            "write_zip_archive",
            started,
            json!({ "outputPath": path, "entries": entries.len(), "bytes": total_bytes }),
        ),
        Err(message) => log_cmd_err("write_zip_archive", started, message.clone()),
    }
    result
}

// Builds the zip entirely in memory so the construction (entry names, contents,
// compression, finalization) can be tested without touching disk.
fn build_zip_bytes(entries: &[(String, String)]) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (entry_name, content) in entries {
        zip.start_file(entry_name, options)
            .map_err(|e| format!("Failed to add {} to zip: {}", entry_name, e))?;
        std::io::Write::write_all(&mut zip, content.as_bytes())
            .map_err(|e| format!("Failed to write {} to zip: {}", entry_name, e))?;
    }

    let cursor = zip
        .finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;
    Ok(cursor.into_inner())
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

// The staging temp-file name write_atomic renames into place. NOTE: it is keyed
// only by the target file name and the process id, so two concurrent writes from
// the SAME process to the SAME path produce the SAME temp name and would clobber
// each other's staging file. That is safe only because the frontend serializes
// writes per path (withSerial in file-system.ts) — this name is not itself a
// concurrency guard.
fn atomic_temp_name(file_name: &str, pid: u32) -> String {
    format!(".{}.{}.tmp", file_name, pid)
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
    let tmp = parent.join(atomic_temp_name(file_name, std::process::id()));

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

// Returns the absolute storage root (`~/.dropkick`, or `DROPKICK_HOME`),
// creating it if missing. The Rust core is the only path resolver: the webview
// calls this once at startup and derives every subpath from the returned
// absolute root, rather than reconstructing the root from `homeDir()` itself
// (which cannot read `DROPKICK_HOME` and is forbidden by the per-stack rule).
#[tauri::command]
fn app_data_root(app: AppHandle) -> Result<String, String> {
    let started = log_cmd_start("app_data_root", json!({}));
    match paths::data_root(&app) {
        Ok(root) => {
            let root = root.to_string_lossy().to_string();
            log_cmd_ok("app_data_root", started, json!({ "root": root }));
            Ok(root)
        }
        Err(message) => {
            log_cmd_err("app_data_root", started, message.clone());
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
            // core has filesystem access even though the webview is sandboxed, and
            // it routes through the single storage-root resolver (paths::data_root)
            // so the log directory and the data directory share one source of
            // truth and both honor DROPKICK_HOME.
            let log_path = paths::data_root(app.handle())?
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
            file_metadata,
            list_files_recursive,
            write_zip_archive,
            app_data_root,
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
    fn classify_json_bytes_success_and_invalid() {
        let json = br#"{"version":"1.0.0","tasks":[]}"#;
        match classify_json_bytes(json) {
            JsonFileWithHashResult::Success { data, hash } => {
                assert_eq!(data.version, "1.0.0");
                assert!(data.tasks.is_empty());
                assert_eq!(hash, sha256_hex(json));
            }
            other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
        }
        assert!(matches!(
            classify_json_bytes(b"{ not json"),
            JsonFileWithHashResult::Invalid { .. }
        ));
    }

    #[test]
    fn build_zip_bytes_produces_a_readable_in_memory_archive() {
        let entries = vec![
            ("tasks.json".to_string(), "hello".to_string()),
            ("prefs.json".to_string(), "world".to_string()),
        ];
        let bytes = build_zip_bytes(&entries).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(archive.len(), 2);
        let mut content = String::new();
        archive
            .by_name("tasks.json")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content, "hello");
    }

    #[test]
    fn atomic_temp_name_is_stable_per_file_and_pid() {
        // Same file + same process => same temp name. This is the documented
        // collision: two same-process writers to one path stage through the same
        // temp file, which is why the frontend serializes writes per path.
        assert_eq!(atomic_temp_name("tasks.json", 1234), ".tasks.json.1234.tmp");
        assert_eq!(
            atomic_temp_name("tasks.json", 1234),
            atomic_temp_name("tasks.json", 1234)
        );
        // A different pid or file name yields a different temp name.
        assert_ne!(
            atomic_temp_name("tasks.json", 1234),
            atomic_temp_name("tasks.json", 5678)
        );
        assert_ne!(atomic_temp_name("a.json", 1), atomic_temp_name("b.json", 1));
    }

    #[test]
    fn write_zip_archive_writes_a_readable_zip() {
        let dir = unique_temp_dir("backup");
        let output = dir.join("nested").join("backup.zip");
        let entries = vec![
            ("tasks.json".to_string(), "hello".to_string()),
            ("prefs.json".to_string(), "world".to_string()),
        ];
        let returned = write_zip_archive(entries, output.to_str().unwrap().to_string()).unwrap();
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
    fn file_metadata_reports_size_and_mtime() {
        let dir = unique_temp_dir("file-meta");
        let path = dir.join("doc.json");
        std::fs::write(&path, b"hello").unwrap();
        let meta = file_metadata(path.to_str().unwrap()).unwrap();
        assert_eq!(meta.size, 5);
        assert!(meta.mtime_ms > 0.0);
    }

    #[test]
    fn file_metadata_errors_for_missing_file() {
        let dir = unique_temp_dir("file-meta-missing");
        let path = dir.join("nope.json");
        assert!(file_metadata(path.to_str().unwrap()).is_err());
    }

    #[test]
    fn list_files_recursive_returns_empty_for_missing_root() {
        let dir = unique_temp_dir("walk-missing");
        let missing = dir.join("does-not-exist");
        let result = list_files_recursive(missing.to_str().unwrap().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn list_files_recursive_walks_nested_files_with_relative_forward_slash_paths() {
        let dir = unique_temp_dir("walk");
        std::fs::write(dir.join("state.json"), b"{}").unwrap();
        let nested = dir.join("logs").join("inner");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("a.log"), b"x").unwrap();

        let mut result = list_files_recursive(dir.to_str().unwrap().to_string()).unwrap();
        result.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

        let paths: Vec<&str> = result.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["logs/inner/a.log", "state.json"]);
        // Sizes are reported; the nested file is 1 byte.
        let nested_entry = result
            .iter()
            .find(|f| f.relative_path == "logs/inner/a.log")
            .unwrap();
        assert_eq!(nested_entry.size, 1);
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

