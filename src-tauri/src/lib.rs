use std::collections::HashSet;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

// The modules are `pub` so the integration tests in `tests/` can reach them.
// This crate's only real consumer is `main.rs`, so the "public API" is a seam
// for testing rather than a surface anyone depends on — which is the trade the
// tests-folder-conventions ask for: promote the helper, do not test it through
// a shell, and keep shipped source free of test modules.
pub mod backup_store;
pub mod logging;
pub mod nanoid;
pub mod paths;

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
pub struct NoteDto {
    pub id: String,
    pub content: String,
    pub actionability: String,
    pub created_at_utc: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    pub completed_at_utc: Option<String>,
    pub notes: Vec<NoteDto>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListDto {
    pub version: String,
    // A stable identity materialized on load (see task-list-repository.ts). Legacy
    // files predate the field, so it defaults to empty on read; the frontend fills
    // and persists it. It rides through this struct so read_json_file_with_hash —
    // which returns the deserialized DTO, not the raw text — never strips it.
    #[serde(default)]
    pub id: String,
    pub tasks: Vec<TaskDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum JsonFileWithHashResult {
    Success { data: TaskListDto, hash: String },
    Missing,
    Invalid { message: String },
    Error { message: String },
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

// Every filesystem command below carries `#[tauri::command(async)]`.
//
// A plain `#[tauri::command]` executes INLINE on the thread that drives the
// webview, so all of this ran on the UI thread: a single save costs three
// fsyncs plus a SQLite insert of the whole document, note drafts write through
// every few seconds while the user is typing, and a contended backup write
// waits up to the store's five-second busy timeout — a five-second frozen
// window. The attribute on a SYNC function is the one that dispatches to
// Tauri's thread pool (its own name for it is "sync_threadpool"); writing these
// as `async fn` instead would hand blocking std::fs work to an async-runtime
// worker, which is the wrong pool for it.
//
// file_exists takes an owned String because a command that returns something
// other than a Result cannot borrow from the invoke message.
// Computes SHA-256 hash of a file's raw bytes.
// Called from TypeScript before every write to detect external modifications.
#[tauri::command(async)]
fn hash_file(path: &str) -> Result<Option<String>, String> {
    let started = log_cmd_start("hash_file", json!({ "path": path }));
    match std::fs::read(path) {
        Ok(bytes) => {
            let hash = sha256_hex(&bytes);
            log_cmd_ok(
                "hash_file",
                started,
                json!({ "path": path, "bytes": bytes.len() }),
            );
            Ok(Some(hash))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            log_cmd_ok(
                "hash_file",
                started,
                json!({ "path": path, "outcome": "missing" }),
            );
            Ok(None)
        }
        Err(e) => {
            log_cmd_err("hash_file", started, e.to_string());
            Err(e.to_string())
        }
    }
}

// Reads a JSON file once, parses it, and returns an explicit result with a
// hash of the exact bytes that were read.
#[tauri::command(async)]
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
pub fn classify_json_bytes(bytes: &[u8]) -> JsonFileWithHashResult {
    match serde_json::from_slice::<TaskListDto>(bytes) {
        Ok(data) => match validate_task_list_identities(&data) {
            Ok(()) => JsonFileWithHashResult::Success {
                data,
                hash: sha256_hex(bytes),
            },
            Err(message) => JsonFileWithHashResult::Invalid { message },
        },
        Err(err) => JsonFileWithHashResult::Invalid {
            message: err.to_string(),
        },
    }
}

fn validate_task_list_identities(data: &TaskListDto) -> Result<(), String> {
    let mut task_ids = HashSet::new();
    for task in &data.tasks {
        if !task_ids.insert(task.id.as_str()) {
            return Err("duplicate task id".to_string());
        }

        let mut note_ids = HashSet::new();
        for note in &task.notes {
            if !note_ids.insert(note.id.as_str()) {
                return Err("duplicate note id within task".to_string());
            }
        }
    }
    Ok(())
}

// Generic text read with an explicit missing/success/error union — the
// non-task-list counterpart to read_json_file_with_hash. Moving plain reads
// here (alongside writes/exists/mkdir below) lets the webview drop the Tauri fs
// plugin, so no file API is exposed to page script directly.
//
// It is NOT a sandbox, and nothing here should be read as one: these commands
// take an absolute path straight from the webview and hand it to std::fs with
// no scope, canonicalization or traversal check, which is broader reach than
// the fs plugin's `$HOME/**` would have been. Nothing in the app can execute
// attacker code in the renderer — no eval, no dangerouslySetInnerHTML, no shell
// — so the exposure is a supply-chain one: a compromised npm dependency runs as
// `'self'` script and can read or write any file the user can. Scoping these
// commands (a runtime allow-list grown from the paths the user actually picks
// in a dialog) is open work, tracked in the fleet app-review plan.
#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum TextReadResult {
    Success { text: String },
    Missing,
    Error { message: String },
}

#[tauri::command(async)]
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
// The staging file's name is `<stem>-<nanoid>.tmp` (see atomic_temp_name); the
// nanoid discriminator is generated here, in the Rust core, via the `nanoid`
// module — no caller-supplied token crosses the IPC boundary.
// Returns the SHA-256 of the bytes it wrote. The caller needs that hash to
// detect a later external modification, and computing it here from the bytes
// already in hand saves reading the whole file back — and removes the window in
// which a re-read could hash a concurrent writer's content instead of this
// call's.
#[tauri::command(async)]
fn write_text_file_atomic(path: &str, contents: &str) -> Result<String, String> {
    let started = log_cmd_start(
        "write_text_file_atomic",
        json!({ "path": path, "bytes": contents.len() }),
    );
    let result = write_atomic(path, contents);
    match &result {
        Ok(_) => log_cmd_ok(
            "write_text_file_atomic",
            started,
            json!({ "path": path, "bytes": contents.len() }),
        ),
        Err(message) => log_cmd_err("write_text_file_atomic", started, message.clone()),
    }
    result
}

// The staging temp-file name an atomic write renames into place:
// `<stem>-<nanoid>.tmp`, sibling to the target (stem = the target's file name
// without its final extension). The nanoid discriminator is generated fresh
// per call, so distinct calls — even concurrent ones to the same path — get
// distinct staging files. That said, the frontend still serializes writes per
// path (withSerial in file-system.ts) for the unrelated reason of keeping
// hash-checked reads and writes from interleaving.
pub fn atomic_temp_name(file_name: &str) -> String {
    let stem = std::path::Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    format!("{}-{}.tmp", stem, nanoid::generate())
}

// Follows a symlinked target to the file it points at, up to a small bound so a
// link loop cannot spin.
//
// An atomic write replaces a directory entry, so writing to the link's own path
// would replace the LINK with a regular file: every later save would land on the
// link's former location and the real file would go permanently stale, with
// nothing surfaced. Task lists are documented as living "at any path", and
// symlinking one into a synced folder or a dotfiles repo is exactly the kind of
// setup that invites. Resolving one level at a time (rather than canonicalize)
// keeps the returned path in its original form — canonicalize hands back a
// `\\?\` extended-length path on Windows, which would then leak into the temp
// file's sibling name and the backup store's key.
fn resolve_symlink(path: &std::path::Path) -> std::path::PathBuf {
    let mut current = path.to_path_buf();
    for _ in 0..8 {
        let is_link = std::fs::symlink_metadata(&current)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if !is_link {
            break;
        }
        let Ok(dest) = std::fs::read_link(&current) else {
            break;
        };
        current = if dest.is_absolute() {
            dest
        } else {
            match current.parent() {
                Some(parent) => parent.join(dest),
                None => dest,
            }
        };
    }
    current
}

pub fn write_atomic(path: &str, contents: &str) -> Result<String, String> {
    use std::io::Write;
    let resolved = resolve_symlink(std::path::Path::new(path));
    let target = resolved.as_path();
    let parent = target
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;
    let tmp = parent.join(atomic_temp_name(file_name));

    let write_tmp = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    // The rename below replaces the target's inode, so the temp file's mode is
    // what survives — `File::create` gives it 0666 & ~umask (typically 0644),
    // which would silently widen a file the user had restricted to 0600. Carry
    // the existing target's permissions over. Best-effort: a filesystem that
    // cannot set them is not a reason to fail a save.
    if let Ok(existing) = std::fs::metadata(target) {
        let _ = std::fs::set_permissions(&tmp, existing.permissions());
    }
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

    // --- Data-backup record hook (data-backup conventions) ---
    // The rename has landed: `target` now holds exactly `contents` and is where it
    // belongs, so — and only now, strictly AFTER the rename — record the exact raw
    // bytes we just wrote into the write-through store. Recording before the rename
    // would risk a "backup of a save that never happened". We reuse the in-hand
    // bytes (`contents.as_bytes()`), never re-reading the file (which would risk
    // capturing a concurrent writer's content, not what this call wrote).
    //
    // This is the ONE managed-text choke point every managed write funnels through
    // (webview -> write_text_file_atomic -> here), so the hook lives in exactly one
    // place. record() is best-effort and silent on success; it never throws, never
    // breaks this save that already succeeded above, and never crashes the app.
    // Managed durable text (state.json, preferences/workspaces/task-lists — internal
    // and external) is recorded on every save; dedup absorbs the churn. The only
    // things NOT recorded are what never reaches this path: append-mode logs
    // (logging.rs opens with create_new + per-line write_all, never atomically) and
    // the backup_store's own SQLite file (written by the backup layer, not here).
    backup_store::record(target, contents.as_bytes());

    Ok(sha256_hex(contents.as_bytes()))
}

#[tauri::command(async)]
fn file_exists(path: String) -> bool {
    let path = path.as_str();
    std::path::Path::new(path).exists()
}

// `<stem>-<yyyymmdd-hhmmss-fff-utc>.invalid` beside the source — the
// derived-filename grammar with a moment discriminator (storage-path
// conventions' quarantine name).
pub fn quarantine_target(path: &std::path::Path) -> std::path::PathBuf {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("store");
    path.with_file_name(format!("{stem}-{}.invalid", logging::filename_stamp_now()))
}

// Quarantines a present-but-unparseable managed store: renames it beside itself
// to its quarantine name so the original bytes survive for recovery while the
// caller recreates defaults. The rename either lands or errors — a failure must
// reach the caller and halt the load, never fall through to a default-reset
// over the very bytes quarantine exists to preserve (storage-path conventions).
#[tauri::command(async)]
fn quarantine_file(path: &str) -> Result<String, String> {
    let started = log_cmd_start("quarantine_file", json!({ "path": path }));
    let target = quarantine_target(std::path::Path::new(path));
    match std::fs::rename(path, &target) {
        Ok(()) => {
            let target = target.to_string_lossy().to_string();
            log_cmd_ok(
                "quarantine_file",
                started,
                json!({ "path": path, "quarantinedTo": target }),
            );
            Ok(target)
        }
        Err(e) => {
            let message = e.to_string();
            log_cmd_err("quarantine_file", started, message.clone());
            Err(message)
        }
    }
}

#[tauri::command(async)]
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
#[tauri::command(async)]
fn app_paths(app: AppHandle) -> Result<paths::AppPaths, String> {
    let started = log_cmd_start("app_paths", json!({}));
    match paths::data_root(&app) {
        Ok(root) => {
            let layout = paths::app_paths(&root);
            log_cmd_ok("app_paths", started, json!({ "root": layout.root }));
            Ok(layout)
        }
        Err(message) => {
            log_cmd_err("app_paths", started, message.clone());
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
            //
            // A storage-root failure must NOT abort the launch. This hook runs
            // before the logger is open and before the panic hook is installed,
            // so propagating the error here turns into a panic at the .expect()
            // below: the window is already built, so it flashes and vanishes
            // with exit code 101, and the carefully-worded message from
            // paths::data_root reaches nowhere — no log file, no dialog — while
            // StartupErrorScreen, built for exactly this class of failure, is
            // never reached. Degrade instead: skip the log file and the backup
            // store, let the window open, and let the webview's own
            // app_paths call return the same error for that screen to show.
            match paths::data_root(app.handle()) {
                Ok(data_root) => {
                    let layout = paths::app_paths(&data_root);
                    let log_path = std::path::Path::new(&layout.logs_dir)
                        .join(logging::session_filename());
                    logging::init(&log_path, debug_enabled);
                    install_panic_hook();

                    // Open the write-through data-backup store once, best-effort,
                    // under the same DROPKICK_HOME-aware root (never a hardcoded
                    // path). If it cannot open, one warn is logged and recording is
                    // disabled for the session — it never blocks startup. Every
                    // managed-text save from now on records through it, strictly
                    // after its atomic rename lands (see write_atomic).
                    backup_store::init(std::path::PathBuf::from(&layout.backups_file));

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
                }
                Err(message) => {
                    // There is no log file to write to — this IS the failure to
                    // open one. stderr is the only channel left, and it reaches
                    // a terminal launch; the user sees the error in the window.
                    install_panic_hook();
                    eprintln!("dropkick: storage root unavailable: {message}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hash_file,
            read_json_file_with_hash,
            read_text_file,
            write_text_file_atomic,
            file_exists,
            quarantine_file,
            ensure_dir,
            app_paths,
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
// These stay in shipped source, which the tests-folder-conventions otherwise
// forbid, under its one stated exception: their subjects are #[tauri::command]
// functions, and a command cannot be promoted to `pub` in this crate — the
// attribute macro emits a #[macro_export] copy of its generated macro, which
// then collides with the local definition at the crate root (verified: E0255,
// "the name `__cmd__hash_file` is defined multiple times"). Testing them
// through the IPC layer instead would be testing through a shell, which the
// convention rules out for the same reason.
//
// Everything that is NOT a command has been promoted and moved out: the digest,
// the temp-file naming, the JSON classifier, the quarantine name and
// write_atomic are exercised from tests/atomic_write.rs.
mod tests {
    use super::*;
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
    fn hash_file_hashes_actual_bytes() {
        let dir = unique_temp_dir("hash");
        let path = dir.join("f.txt");
        std::fs::write(&path, b"abc").unwrap();
        let result = hash_file(path.to_str().unwrap()).unwrap();
        assert_eq!(result, Some(sha256_hex(b"abc")));
    }

    #[test]
    fn hash_file_returns_missing_for_an_absent_file() {
        let dir = unique_temp_dir("hash-missing");
        let path = dir.join("absent.txt");
        assert_eq!(hash_file(path.to_str().unwrap()).unwrap(), None);
    }

    #[test]
    fn quarantine_file_renames_and_preserves_bytes() {
        let dir = unique_temp_dir("quarantine");
        let path = dir.join("state.json");
        std::fs::write(&path, b"{ corrupt bytes").unwrap();

        let quarantined = quarantine_file(path.to_str().unwrap()).unwrap();

        assert!(!path.exists(), "source must be renamed away");
        assert_eq!(std::fs::read(&quarantined).unwrap(), b"{ corrupt bytes");
    }

    #[test]
    fn quarantine_file_errors_for_missing_source() {
        let dir = unique_temp_dir("quarantine-missing");
        let path = dir.join("absent.json");
        assert!(quarantine_file(path.to_str().unwrap()).is_err());
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
    fn file_exists_reflects_presence() {
        let dir = unique_temp_dir("exists");
        let path = dir.join("f.txt");
        assert!(!file_exists(path.to_string_lossy().into_owned()));
        std::fs::write(&path, b"x").unwrap();
        assert!(file_exists(path.to_string_lossy().into_owned()));
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
