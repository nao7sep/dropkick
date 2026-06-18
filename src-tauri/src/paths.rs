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
//! Both the log-file resolver (`run()` in `lib.rs`) and the `app_data_root`
//! command the frontend calls route through `data_root` here, so there is one
//! source of truth and the frontend never reconstructs `~/.dropkick` itself.

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
    let root = resolve_root(&home, std::env::var(HOME_ENV_VAR).ok());
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("could not create storage root {}: {e}", root.display()))?;
    Ok(root)
}

// Pure root resolution, factored out so it can be unit-tested without an
// AppHandle. `override_value` is the raw `DROPKICK_HOME` value (if any).
fn resolve_root(home: &Path, override_value: Option<String>) -> PathBuf {
    if let Some(raw) = override_value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return absolutize(home, expand_tilde(home, trimmed));
        }
    }
    home.join(DATA_DIR_NAME)
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

// A relative override is resolved against the home directory (never the
// working directory), so the override can never reintroduce a cwd dependence.
fn absolutize(home: &Path, path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_root_is_home_dot_dropkick() {
        let home = PathBuf::from("/home/tester");
        // Unset / empty / whitespace all fall back to the default root.
        assert_eq!(resolve_root(&home, None), home.join(".dropkick"));
        assert_eq!(resolve_root(&home, Some(String::new())), home.join(".dropkick"));
        assert_eq!(
            resolve_root(&home, Some("   ".to_string())),
            home.join(".dropkick")
        );
    }

    #[test]
    fn env_var_relocates_root_to_absolute_path() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(
            resolve_root(&home, Some("/tmp/dk-test".to_string())),
            PathBuf::from("/tmp/dk-test")
        );
    }

    #[test]
    fn env_var_expands_leading_tilde() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(resolve_root(&home, Some("~".to_string())), home);
        assert_eq!(
            resolve_root(&home, Some("~/profiles/work".to_string())),
            home.join("profiles/work")
        );
    }

    #[test]
    fn relative_env_var_resolves_against_home_not_cwd() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(
            resolve_root(&home, Some("alt-root".to_string())),
            home.join("alt-root")
        );
    }
}
