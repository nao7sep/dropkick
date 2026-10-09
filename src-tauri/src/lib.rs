use std::collections::HashSet;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

// The modules are `pub` so the integration tests in `tests/` can reach them.
// This crate's only real consumer is `main.rs`, so the "public API" is a seam
// for testing rather than a surface anyone depends on — which is the trade the
// tests-folder-conventions ask for: promote the helper, do not test it through
// a shell, and keep shipped source free of test modules.
pub mod backup_store;
pub mod format_version;
pub mod i18n;
mod instance_owner;
pub mod logging;
pub mod menu;
pub mod nanoid;
pub mod native_wait;
mod os_quit;
pub mod paths;
pub mod records;
pub mod records_window;
pub mod theme;
pub mod window_placement;

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
        logging::flush();
        // The error line is on disk unless the flush gave up; defer to the
        // previous hook so the process still aborts and prints as usual.
        default_hook(info);
    }));
}

// The stored state values, as src/models/task-list.ts names them. Decoding them
// as enums makes a file carrying any other value unreadable rather than loaded
// with a task or note the app cannot place (store-recovery-conventions).
#[derive(Deserialize, Serialize)]
pub enum TaskStatus {
    Pending,
    Completed,
    Dismissed,
}

#[derive(Deserialize, Serialize)]
pub enum TaskPriority {
    Critical,
    Urgent,
    Important,
    Default,
}

#[derive(Deserialize, Serialize)]
pub enum NoteActionability {
    Informational,
    Actionable,
    Resolved,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub content: String,
    pub actionability: NoteActionability,
    pub created_at_utc: String,
    // Absent until the note's content is first edited (task-list.ts), so it
    // stays absent on the way back to the webview rather than arriving as null.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edited_at_utc: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    #[serde(deserialize_with = "required_nullable")]
    pub due_date: Option<String>,
    pub created_at_utc: String,
    pub updated_at_utc: String,
    #[serde(deserialize_with = "required_nullable")]
    pub completed_at_utc: Option<String>,
    pub notes: Vec<NoteDto>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListDto {
    // The list's stable identity, generated once when the list is created.
    pub id: String,
    pub tasks: Vec<TaskDto>,
}

// The task list's format version is not a field: classify_json_bytes judges
// it before the body is parsed, and the frontend's write stamps the current one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum JsonFileWithHashResult {
    Success { data: TaskListDto, hash: String },
    Missing,
    Invalid { message: String },
    Newer {
        #[serde(rename = "formatVersion")]
        format_version: u64,
    },
    Error { message: String },
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

// Every filesystem command below is an `async fn` whose blocking work runs
// through native_wait::settle, on the runtime's blocking pool.
//
// A plain synchronous `#[tauri::command]` executes inline on the thread that
// drives the webview, so a save (three fsyncs plus a backup insert) would freeze
// the window. Tagging a synchronous function `#[tauri::command(async)]` does not
// help: Tauri 2 runs its body inside a task on an async-runtime worker, of which
// there are only as many as cores, so stalled storage could occupy all of them.
// settle hands the work to the blocking pool and awaits its real end, with no
// timeout, so the frontend always learns what a write actually did.
//
// Computes SHA-256 hash of a file's raw bytes.
// Called from TypeScript before every write to detect external modifications.
#[tauri::command]
async fn hash_file(path: String) -> Result<Option<String>, String> {
    native_wait::settle(move || {
        let path = path.as_str();
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
    })
    .await
}

// Reads a JSON file once, parses it, and returns an explicit result with a
// hash of the exact bytes that were read.
#[tauri::command]
async fn read_json_file_with_hash(path: String) -> Result<JsonFileWithHashResult, String> {
    native_wait::settle(move || {
        let path = path.as_str();
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
            JsonFileWithHashResult::Newer { format_version } => log_cmd_ok(
                "read_json_file_with_hash",
                started,
                json!({ "path": path, "bytes": bytes.len(), "outcome": "newer", "formatVersion": format_version }),
            ),
            // classify_json_bytes only yields Success, Invalid or Newer;
            // Missing/Error are decided by the filesystem read above.
            _ => {}
        }
        Ok(result)
    })
    .await
}

// The pure parse/classify half of read_json_file_with_hash: given a file's
// bytes, either parse them into a TaskListDto (Success, with the content hash),
// report a newer build's file (Newer), or report the parse failure (Invalid).
// The format version is judged first, so a newer file is never mistaken for a
// corrupt one. No filesystem access, so it is testable against in-memory bytes.
pub fn classify_json_bytes(bytes: &[u8]) -> JsonFileWithHashResult {
    match format_version::json_bytes(bytes, format_version::Format::TaskList) {
        Ok(format_version::Marker::Readable) => {}
        Ok(format_version::Marker::Newer(format_version)) => {
            return JsonFileWithHashResult::Newer { format_version };
        }
        Err(message) => return JsonFileWithHashResult::Invalid { message },
    }
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

fn required_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn validate_task_list_identities(data: &TaskListDto) -> Result<(), String> {
    if !valid_identity(&data.id) {
        return Err("task list id is invalid".to_string());
    }
    let mut task_ids = HashSet::new();
    for task in &data.tasks {
        if !valid_identity(&task.id) {
            return Err("task id is invalid".to_string());
        }
        if !task_ids.insert(task.id.as_str()) {
            return Err("duplicate task id".to_string());
        }

        let mut note_ids = HashSet::new();
        for note in &task.notes {
            if !valid_identity(&note.id) {
                return Err("note id is invalid".to_string());
            }
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

#[tauri::command]
async fn read_text_file(path: String) -> Result<TextReadResult, String> {
    native_wait::settle(move || {
        let path = path.as_str();
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
    })
    .await
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
#[tauri::command]
async fn write_text_file_atomic(
    path: String,
    contents: String,
    record_backup: Option<bool>,
) -> Result<String, String> {
    native_wait::settle(move || {
        let path = path.as_str();
        let contents = contents.as_str();
        let started = log_cmd_start(
            "write_text_file_atomic",
            json!({ "path": path, "bytes": contents.len() }),
        );
        let result = if record_backup.unwrap_or(true) {
            write_atomic(path, contents)
        } else {
            write_atomic_unrecorded(path, contents)
        };
        match &result {
            Ok(_) => log_cmd_ok(
                "write_text_file_atomic",
                started,
                json!({ "path": path, "bytes": contents.len() }),
            ),
            Err(message) => log_cmd_err("write_text_file_atomic", started, message.clone()),
        }
        result
    })
    .await
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
pub fn resolve_symlink(path: &std::path::Path) -> std::path::PathBuf {
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

// Keep ordinary permissions on the replacement. Its modified time belongs
// to the changed content; no custom metadata transport is needed.
fn carry_replaced_permissions(
    target: &std::path::Path,
    tmp: &std::fs::File,
) -> std::io::Result<()> {
    match std::fs::metadata(target) {
        Ok(existing) => tmp.set_permissions(existing.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

// Puts the staged temp file in the target's place. On Windows a rename takes the
// temp file's inherited access rules; the existing ReplaceFileW primitive
// naturally keeps the target's ACL and attributes. A target that does not exist
// yet is renamed into place.
#[cfg(not(windows))]
fn replace_target(tmp: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    std::fs::rename(tmp, target)
}

#[cfg(windows)]
fn replace_target(tmp: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    windows_replace::replace_file(tmp, target)
}

#[cfg(windows)]
mod windows_replace {
    use std::os::raw::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    // winbase.h and winerror.h. The ignore flags keep the save going when a
    // volume refuses to merge an ACL or stream, as the macOS carry does.
    const REPLACEFILE_IGNORE_MERGE_ERRORS: u32 = 0x0000_0002;
    const REPLACEFILE_IGNORE_ACL_ERRORS: u32 = 0x0000_0004;
    const ERROR_FILE_NOT_FOUND: i32 = 2;

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut c_void,
            reserved: *mut c_void,
        ) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn replace_file(tmp: &Path, target: &Path) -> std::io::Result<()> {
        let (replaced, replacement) = (wide(target), wide(tmp));
        // SAFETY: both strings are NUL-terminated and outlive the call, and null
        // is the documented way to pass no backup file and no reserved values.
        let ok = unsafe {
            ReplaceFileW(
                replaced.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if ok != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) {
            return std::fs::rename(tmp, target);
        }
        Err(error)
    }
}

pub fn write_atomic(path: &str, contents: &str) -> Result<String, String> {
    write_atomic_impl(path, contents, true)
}

// The same atomic write, minus the backup-history record: for volatile state
// that is state and nothing else (view state and window placement), which the data-backup
// convention excludes from backups.sqlite3.
pub fn write_atomic_unrecorded(path: &str, contents: &str) -> Result<String, String> {
    write_atomic_impl(path, contents, false)
}

fn write_atomic_impl(path: &str, contents: &str, record: bool) -> Result<String, String> {
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

    refuse_newer_json(target)?;

    // A write that changes nothing is skipped (content-lifecycle-conventions,
    // Files). A target that is missing or cannot be read takes the write below.
    if std::fs::read(target).is_ok_and(|existing| existing == contents.as_bytes()) {
        return Ok(sha256_hex(contents.as_bytes()));
    }

    let stage_dir = parent.join(atomic_temp_name(file_name));
    let mut directory = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(&stage_dir).map_err(|error| error.to_string())?;
    struct Stage { directory: std::path::PathBuf, file: std::path::PathBuf }
    impl Drop for Stage {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.file);
            let _ = std::fs::remove_dir(&self.directory);
        }
    }
    let tmp = stage_dir.join(file_name);
    let _stage = Stage { directory: stage_dir, file: tmp.clone() };
    let write_tmp = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = options.open(&tmp)?;
        file.write_all(contents.as_bytes())?;
        carry_replaced_permissions(target, &file)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_tmp {
        return Err(e.to_string());
    }

    if let Err(e) = refuse_newer_json(target)
        .and_then(|()| replace_target(&tmp, target).map_err(|e| e.to_string()))
    {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
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
    // Managed durable text (config.json, preferences/workspaces/task-lists — internal
    // and external) is recorded on every save; dedup absorbs the churn. Not
    // recorded: volatile state saved through write_atomic_unrecorded (state.json, window.json, records-window.json),
    // records (records.sqlite3 and its fallback logs, written by logging.rs, never
    // atomically) and the backup_store's own SQLite file (written by the backup
    // layer, not here).
    if record {
        backup_store::record(target, contents.as_bytes());
    }

    Ok(sha256_hex(contents.as_bytes()))
}

fn refuse_newer_json(path: &std::path::Path) -> Result<(), String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if let Ok(format_version::Marker::Newer(found)) =
                format_version::json_bytes(&bytes, format_version::Format::State)
            {
                return Err(format_version::newer_message(
                    path,
                    found,
                    format_version::Format::State,
                ));
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    native_wait::settle(move || {
        Ok(std::path::Path::new(&path).exists())
    })
    .await
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
#[tauri::command]
async fn quarantine_file(path: String) -> Result<String, String> {
    native_wait::settle(move || {
        let path = path.as_str();
        let started = log_cmd_start("quarantine_file", json!({ "path": path }));
        let target = quarantine_target(std::path::Path::new(path));
        refuse_newer_json(std::path::Path::new(path))?;
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
    })
    .await
}

#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    native_wait::settle(move || {
        let path = path.as_str();
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
    })
    .await
}

// Returns the absolute storage root (`~/.dropkick`, or `DROPKICK_DATA_DIR`),
// creating it if missing. The Rust core is the only path resolver: the webview
// calls this once at startup and derives every subpath from the returned
// absolute root, rather than reconstructing the root from `homeDir()` itself
// (which cannot read `DROPKICK_DATA_DIR` and is forbidden by the per-stack rule).
#[tauri::command]
async fn app_paths(app: AppHandle) -> Result<paths::AppPaths, String> {
    native_wait::settle(move || {
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
    })
    .await
}

// Applies a saved theme preference to the calling window: the window theme,
// which the page follows through prefers-color-scheme, and the matching window
// background, together (app-chrome conventions, Theme).
// The main window's theme is the app's, so the Records window takes it too.
#[tauri::command]
fn apply_theme(window: tauri::WebviewWindow, preference: String) -> Result<(), String> {
    let started = log_cmd_start("apply_theme", json!({ "preference": preference }));
    let result = theme::apply(&window, theme::window_theme_for(&preference)).and_then(|()| {
        if window.label() == records_window::LABEL {
            return Ok(());
        }
        records_window::apply_theme(window.app_handle(), &preference)
    });
    match result {
        Ok(()) => {
            log_cmd_ok("apply_theme", started, json!({}));
            Ok(())
        }
        Err(message) => {
            log_cmd_err("apply_theme", started, message.clone());
            Err(message)
        }
    }
}

// Receives a structured log object from the webview frontend and hands it to
// the logger's writer thread (the frontend has no filesystem access of its
// own). It runs on the thread pool, so it never holds the window; the frontend
// sends one entry at a time, so rows keep the order they were logged.
#[tauri::command(async)]
fn log_event(entry: Value) {
    logging::emit_forwarded(entry);
}

// The computer's language, resolved to a supported tag, and its regional
// locale, both read once at launch before anything could override them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageEnvironment {
    system_language: String,
    system_locale: Option<String>,
}

#[tauri::command]
fn language_environment(language: State<i18n::LanguageState>) -> LanguageEnvironment {
    LanguageEnvironment {
        system_language: language.system_language.to_string(),
        system_locale: language.system_locale.clone(),
    }
}

// Rebuilds the native menu in the interface language after it changes. The
// frontend sends the resolved language (System already resolved), so only a
// supported tag is accepted, and the language the menu already speaks is a
// no-op.
#[tauri::command]
fn apply_language(
    app: AppHandle,
    state: State<i18n::LanguageState>,
    language: String,
) -> Result<(), String> {
    let started = log_cmd_start("apply_language", json!({ "language": language }));
    let result: Result<(), String> = (|| {
        let language = i18n::normalize_preference(Some(&language))
            .ok_or_else(|| format!("unsupported language {language:?}"))?;
        if state.current() == language {
            return Ok(());
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let menu = menu::build(&app, language).map_err(|error| error.to_string())?;
            app.set_menu(menu).map_err(|error| error.to_string())?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = &app;
        state.set_current(language);
        Ok(())
    })();
    match &result {
        Ok(()) => log_cmd_ok("apply_language", started, json!({})),
        Err(message) => log_cmd_err("apply_language", started, message.clone()),
    }
    result
}

// Opens the Records window, or brings it forward. Window creation runs off the
// main thread, where a synchronous command would deadlock it on Windows.
#[tauri::command(async)]
fn open_records_window(
    app: AppHandle,
    context: records_window::RecordsWindowContext,
) -> Result<(), String> {
    let started = log_cmd_start("open_records_window", json!({}));
    let result = records_window::open(&app, &context);
    match &result {
        Ok(()) => log_cmd_ok("open_records_window", started, json!({})),
        Err(message) => log_cmd_err("open_records_window", started, message.clone()),
    }
    result
}

// The records reads log only their failures (see records.rs): each stored
// record signals the Records window, so a logged success would start the next
// read. A failure is recorded once, and the window reads no further on
// signals until a read succeeds.
async fn read_records<T: Send + 'static>(
    command: &str,
    read: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    let started = Instant::now();
    let result = native_wait::settle(move || {
        logging::records_file()
            .ok_or_else(|| "the records database is not open".to_string())
            .and_then(|path| records::open(&path))
            .and_then(|conn| read(&conn).map_err(|e| e.to_string()))
    })
    .await;
    if let Err(message) = &result {
        log_cmd_err(command, started, message.clone());
    }
    result
}

#[tauri::command]
async fn read_records_page(query: records::RecordsQuery) -> Result<records::RecordsPage, String> {
    read_records("read_records_page", move |conn| {
        records::read_page(conn, &query)
    })
    .await
}

#[tauri::command]
async fn read_record_sources() -> Result<records::RecordSources, String> {
    read_records("read_record_sources", |conn| {
        records::read_sources(conn, logging::session())
    })
    .await
}

#[tauri::command]
async fn read_record_detail(id: i64) -> Result<Option<records::RecordDetail>, String> {
    read_records("read_record_detail", move |conn| {
        records::read_detail(conn, id)
    })
    .await
}

// Reports whether developer-only `debug` logging is on, so the frontend can
// gate its own debug events identically (a dev build, or DROPKICK_DEBUG=1).
#[tauri::command]
fn logging_debug_enabled() -> bool {
    logging::debug_enabled()
}

// The main window's writes are settled for the end of the session
// (src-tauri/src/os_quit.rs).
#[tauri::command]
fn session_end_settled() {
    os_quit::session_end_settled();
}

// Takes the placement of every window still open, before the placements are
// written. A window closed by the user had its placement taken as it closed.
fn capture_open_windows(app_handle: &AppHandle) {
    let placements = app_handle.state::<window_placement::WindowPlacements>();
    if let Some(window) = app_handle.get_webview_window("main") {
        window_placement::capture(&window.as_ref().window(), &placements.main);
    }
    if let Some(window) = app_handle.get_webview_window(records_window::LABEL) {
        window_placement::capture(&window.as_ref().window(), &placements.records);
    }
}

#[cfg(target_os = "macos")]
fn reopen_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let result = window.is_minimized().and_then(|minimized| {
        if !minimized {
            return Ok(());
        }
        window.unminimize()?;
        window.set_focus()
    });
    if let Err(error) = result {
        logging::warn("main window reopen failed", json!({ "error": error.to_string() }));
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

    // The interface language is settled before Tauri builds the app: macOS fixes
    // AppKit's language when the application object is created.
    let language = i18n::LanguageState::detect(
        paths::data_root_before_launch()
            .map(|root| std::path::PathBuf::from(paths::app_paths(&root).state_file))
            .as_deref(),
    );
    #[cfg(target_os = "macos")]
    i18n::align_appkit(language.current());
    let app = tauri::Builder::default()
        .manage(language)
        .manage(window_placement::WindowPlacements::new())
        .plugin(instance_owner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app, event| {
            if event.id().as_ref() == menu::QUIT_ID {
                menu::request_quit(app);
            }
        })
        .on_window_event(move |window, event| {
            window_placement::on_window_event(
                window,
                event,
                &window.state::<window_placement::WindowPlacements>(),
            );
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                records_window::close_with_main(window.app_handle());
            }
            // Under System the OS appearance can change while the app runs; keep
            // the backing behind the page in step. (macOS reports only OS
            // changes here, which is why apply_theme sets the background itself.)
            if let tauri::WindowEvent::ThemeChanged(changed) = event {
                if let Err(error) =
                    window.set_background_color(Some(theme::window_background(*changed)))
                {
                    logging::warn(
                        "window background update failed",
                        json!({ "error": error.to_string() }),
                    );
                }
            }
        })
        .setup(move |app| {
            // Open this session's logger under the app's own data dir. The Rust
            // core has filesystem access even though the webview is sandboxed, and
            // it routes through the single storage-root resolver (paths::data_root)
            // so the records database and the data directory share one source of
            // truth and both honor DROPKICK_DATA_DIR.
            //
            // A storage-root failure must NOT abort the launch. This hook runs
            // before the logger is open and before the panic hook is installed,
            // so propagating the error here turns into a panic at the .expect()
            // below: the window is already built, so it flashes and vanishes
            // with exit code 101, and the carefully-worded message from
            // paths::data_root reaches nowhere — no record, no dialog — while
            // StartupErrorScreen, built for exactly this class of failure, is
            // never reached. Degrade instead: skip the logger and the backup
            // store, let the window open, and let the webview's own
            // app_paths call return the same error for that screen to show.
            let root_handle = app.handle().clone();
            match native_wait::run("app-paths".to_string(), move || {
                paths::data_root(&root_handle)
            }) {
                Ok(data_root) => {
                    let layout = paths::app_paths(&data_root);
                    let records_path = std::path::Path::new(&layout.records_file);
                    logging::init(
                        records_path,
                        std::path::Path::new(&layout.logs_dir),
                        debug_enabled,
                    );
                    install_panic_hook();
                    let handle = app.handle().clone();
                    logging::on_stored(move || records_window::notify_changed(&handle));

                    // Open the write-through data-backup store once, best-effort,
                    // under the same DROPKICK_DATA_DIR-aware root (never a hardcoded
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
                            "recordsPath": records_path.to_string_lossy(),
                            "os": std::env::consts::OS,
                            "arch": std::env::consts::ARCH,
                        }),
                    );
                }
                Err(message) => {
                    // There is nowhere to record to — this IS the failure to
                    // resolve one. stderr is the only channel left, and it reaches
                    // a terminal launch; the user sees the error in the window.
                    install_panic_hook();
                    eprintln!("dropkick: storage root unavailable: {message}");
                }
            }
            // The native menu speaks the interface language from the first frame.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                let language = app.state::<i18n::LanguageState>().current();
                let menu = menu::build(app.handle(), language)?;
                app.set_menu(menu)?;
            }
            if let Some(window) = app.get_webview_window("main") {
                // The theme of the preferences document the startup picker will
                // preview is applied before the window is shown, so the first
                // frame and title bar already match it; the frontend re-applies
                // the theme whenever a document loads or Settings are saved.
                let saved_theme = paths::data_root(app.handle()).ok().and_then(|root| {
                    theme::read_saved_window_theme(std::path::Path::new(
                        &paths::app_paths(&root).state_file,
                    ))
                });
                if let Err(error) = theme::apply(&window, saved_theme) {
                    logging::warn("apply saved window theme failed", json!({ "error": error }));
                }
                window_placement::restore(
                    app.handle(),
                    &window.as_ref().window(),
                    &app.state::<window_placement::WindowPlacements>().main,
                );
                window.show()?;
            }
            os_quit::install(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_language,
            apply_theme,
            language_environment,
            hash_file,
            read_json_file_with_hash,
            read_text_file,
            write_text_file_atomic,
            file_exists,
            quarantine_file,
            ensure_dir,
            app_paths,
            log_event,
            logging_debug_enabled,
            open_records_window,
            read_records_page,
            read_record_sources,
            read_record_detail,
            session_end_settled
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            capture_open_windows(app_handle);
        }
        // A Dock click brings a minimized main window back, also while the
        // Records window is open, where AppKit would only bring the app
        // forward.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            reopen_main(app_handle);
        }
        if let tauri::RunEvent::Exit = event {
            native_wait::exit_tail(|| {
                // The end of a session exits with its windows still open.
                capture_open_windows(app_handle);
                window_placement::save_all(
                    app_handle,
                    &app_handle.state::<window_placement::WindowPlacements>(),
                );
                logging::info("app shutdown", json!({ "reason": "exit" }));
                logging::shutdown();
            });
        }
    });
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the subjects are #[tauri::command] functions, which
// cannot be promoted to `pub` in this crate: the attribute macro emits a #[macro_export] copy of
// its generated macro, which then collides with the local definition at the crate root (E0255).
// Everything that is not a command has been promoted and moved out — the digest, the temp-file
// naming, the JSON classifier, the quarantine name and write_atomic are exercised from
// tests/atomic_write.rs.
#[path = "../tests/unit/lib.rs"]
mod tests;
