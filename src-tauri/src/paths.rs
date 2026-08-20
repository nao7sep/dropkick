//! The single source of truth for dropkick's storage root.
//!
//! Per the storage-path conventions, the Tauri **Rust core** is the only path
//! resolver — the sandboxed webview never computes a data path. The root is
//! `DROPKICK_HOME` when that variable is set and non-empty; otherwise it
//! defaults to `~/.dropkick`. The override value is expanded (a leading `~`
//! becomes the home directory) and made absolute against the **home**
//! directory — never the current working directory — so the location the app
//! reads and writes can never depend on how the process was launched.
//!
//! Both the log-file resolver (`run()` in `lib.rs`) and the `app_paths`
//! command the frontend calls route through `data_root` here, so there is one
//! source of truth and the frontend never reconstructs `~/.dropkick` itself.

use serde::Serialize;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const DATA_DIR_NAME: &str = ".dropkick";
const HOME_ENV_VAR: &str = "DROPKICK_HOME";

// Resolves the absolute storage root and ensures it exists. Returns a clear
// error (and the caller stops) if the home directory is unknown or the root
// cannot be created — never a silent fallback to a different location.
pub fn data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("could not resolve home directory: {e}"))?;
    let root = resolve_root(&home, std::env::var(HOME_ENV_VAR).ok())?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("could not create storage root {}: {e}", root.display()))?;
    Ok(root)
}

// Root resolution, factored out so it can be unit-tested with an injected home
// directory. `override_value` is the raw `DROPKICK_HOME` value (if any). The
// value is expanded (environment references first, then a leading `~`) and made
// absolute against the home directory. An override that is set but expands to
// nothing — an unset `$VAR`/`%VAR%`, say — is a reported error, never a silent
// collapse onto the bare home directory.
pub fn resolve_root(home: &Path, override_value: Option<String>) -> Result<PathBuf, String> {
    let Some(raw) = override_value else {
        return Ok(home.join(DATA_DIR_NAME));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(home.join(DATA_DIR_NAME));
    }
    let expanded = expand_env_references(trimmed);
    let expanded = expanded.trim();
    if expanded.is_empty() {
        return Err(format!(
            "{HOME_ENV_VAR} is set to \"{raw}\" but expands to an empty path \
             (an unset $VAR/%VAR%?). Set it to a usable directory, or unset it to use ~/{DATA_DIR_NAME}."
        ));
    }
    Ok(absolutize(home, expand_tilde(home, expanded)))
}

// Expands a leading `~` / `~/` (and `~\` on Windows) to the home directory.
fn expand_tilde(home: &Path, value: &str) -> PathBuf {
    if value == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = value.strip_prefix("~/").or_else(|| value.strip_prefix("~\\")) {
        return home.join(rest);
    }
    PathBuf::from(value)
}

// Expands `${VAR}`, `$VAR` (POSIX) and `%VAR%` (Windows) references in the
// override against the environment. An unset reference expands to empty,
// matching shell behavior, rather than being left as a literal path segment.
// Identifier characters are ASCII, so all slicing lands on char boundaries.
fn expand_env_references(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("${") {
            if let Some(end) = after.find('}') {
                out.push_str(&std::env::var(&after[..end]).unwrap_or_default());
                rest = &after[end + 1..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('$') {
            let bytes = after.as_bytes();
            let mut n = 0;
            while n < bytes.len()
                && (bytes[n].is_ascii_alphanumeric() || bytes[n] == b'_')
                && !(n == 0 && bytes[n].is_ascii_digit())
            {
                n += 1;
            }
            if n > 0 {
                out.push_str(&std::env::var(&after[..n]).unwrap_or_default());
                rest = &after[n..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('%') {
            if let Some(end) = after.find('%') {
                let name = &after[..end];
                if !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                    out.push_str(&std::env::var(name).unwrap_or_default());
                    rest = &after[end + 1..];
                    continue;
                }
            }
        }
        let mut chars = rest.chars();
        out.push(chars.next().unwrap());
        rest = chars.as_str();
    }
    out
}

// A relative override is resolved against the home directory (never the
// working directory), so the override can never reintroduce a cwd dependence.
fn absolutize(home: &Path, path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

// The names of every standard subpath under the storage root.
//
// They live here, beside the resolver that owns the root, because the
// storage-path conventions put the whole layout in one place — and because on
// Tauri the webview must never resolve a data path itself. Scattered across the
// two processes, the layout was described nowhere: adding or renaming a store
// meant finding five unrelated files, and the sandboxed half was composing
// absolute paths with a hand-rolled separator guess.
const STATE_FILE: &str = "state.json";
const PREFERENCES_FILE: &str = "preferences.json";
const WORKSPACE_FILE: &str = "workspace.json";
const NOTE_DRAFTS_FILE: &str = "note-drafts.json";
const LOGS_DIR: &str = "logs";
const BACKUPS_FILE: &str = "backups.sqlite3";

/// Every path the app reads or writes under its storage root, resolved once.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub root: String,
    pub state_file: String,
    pub preferences_file: String,
    pub workspace_file: String,
    pub note_drafts_file: String,
    pub logs_dir: String,
    pub backups_file: String,
}

pub fn app_paths(root: &Path) -> AppPaths {
    let at = |name: &str| root.join(name).to_string_lossy().into_owned();
    AppPaths {
        root: root.to_string_lossy().into_owned(),
        state_file: at(STATE_FILE),
        preferences_file: at(PREFERENCES_FILE),
        workspace_file: at(WORKSPACE_FILE),
        note_drafts_file: at(NOTE_DRAFTS_FILE),
        logs_dir: at(LOGS_DIR),
        backups_file: at(BACKUPS_FILE),
    }
}
