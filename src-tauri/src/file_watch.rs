//! Watches the task lists the main window has open, so a list edited outside
//! the app can reload itself. The window starts a watch when it loads a list and
//! stops it when the tab closes; the core tells the window which path changed,
//! and the window decides what that means.
//!
//! A list is watched through its directory, not the file itself: an atomic save
//! (Dropkick's own, or most editors') replaces the file's directory entry, and a
//! watch on the file would end with the first such save. One watcher serves the
//! whole app. A symlinked list is watched where it points, which is where every
//! save lands (see `resolve_symlink`).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::json;

use crate::{logging, resolve_symlink};

/// Sent to the main window with the path of a watched list that changed.
pub const CHANGED_EVENT: &str = "task-list-file-changed";

// A watched file as the watcher reports it: its directory, canonical, and its
// name in that directory.
type Target = (PathBuf, OsString);

#[derive(Default)]
struct Targets {
    // The paths the window asked for, by the file they name.
    paths_by_target: HashMap<Target, Vec<String>>,
    target_by_path: HashMap<String, Target>,
}

impl Targets {
    fn watches_dir(&self, dir: &Path) -> bool {
        self.paths_by_target.keys().any(|(watched, _)| watched == dir)
    }

    fn add(&mut self, path: &str, target: Target) {
        self.paths_by_target
            .entry(target.clone())
            .or_default()
            .push(path.to_string());
        self.target_by_path.insert(path.to_string(), target);
    }

    // Returns the removed path's target, if it was watched.
    fn remove(&mut self, path: &str) -> Option<Target> {
        let target = self.target_by_path.remove(path)?;
        if let Some(paths) = self.paths_by_target.get_mut(&target) {
            paths.retain(|p| p != path);
            if paths.is_empty() {
                self.paths_by_target.remove(&target);
            }
        }
        Some(target)
    }
}

pub struct FileWatches {
    listener: Arc<dyn Fn(&str) + Send + Sync>,
    // Read by the watcher's own thread for every event.
    targets: Arc<Mutex<Targets>>,
    // Held across every call into the watcher, so watches and unwatches apply in
    // order. The event handler never takes it: a watcher may wait for its
    // handler to return when a directory is unwatched.
    watcher: Mutex<Option<RecommendedWatcher>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// The file a path names, as the watcher will report it. Fails when its
// directory cannot be resolved.
fn target_of(path: &Path) -> Result<Target, String> {
    let resolved = resolve_symlink(path);
    let name = resolved
        .file_name()
        .ok_or_else(|| format!("not a file path: {}", path.display()))?
        .to_os_string();
    let dir = match resolved.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let dir = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    Ok((dir, name))
}

// The file an event path names. The watcher reports paths under the directory
// it was given, except FSEvents, which reports real paths; canonicalizing the
// directory here as well as at watch time makes both agree.
fn event_target(path: &Path) -> Option<Target> {
    let name = path.file_name()?.to_os_string();
    let parent = path.parent()?;
    let dir = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    Some((dir, name))
}

impl FileWatches {
    /// `listener` receives each changed path as the window asked to watch it.
    /// It runs on the watcher's thread, once per event: bursts are the
    /// window's to coalesce.
    pub fn new(listener: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self {
            listener: Arc::new(listener),
            targets: Arc::new(Mutex::new(Targets::default())),
            watcher: Mutex::new(None),
        }
    }

    fn create_watcher(&self) -> Result<RecommendedWatcher, String> {
        let targets = Arc::clone(&self.targets);
        let listener = Arc::clone(&self.listener);
        notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let event = match result {
                Ok(event) => event,
                Err(error) => {
                    logging::warn("file watch error", json!({ "error": error.to_string() }));
                    return;
                }
            };
            // Reads, the window's own reload among them, change nothing.
            if matches!(event.kind, EventKind::Access(_)) {
                return;
            }
            let changed: Vec<Target> = event.paths.iter().filter_map(|p| event_target(p)).collect();
            let mut paths: Vec<String> = {
                let targets = lock(&targets);
                changed
                    .iter()
                    .filter_map(|target| targets.paths_by_target.get(target))
                    .flatten()
                    .cloned()
                    .collect()
            };
            // A rename names the same file as both its source and destination.
            paths.sort();
            paths.dedup();
            for path in paths {
                listener(&path);
            }
        })
        .map_err(|e| e.to_string())
    }

    /// Starts watching `path`. Watching a path already watched does nothing.
    pub fn watch(&self, path: &str) -> Result<(), String> {
        let target = target_of(Path::new(path))?;
        let mut watcher = lock(&self.watcher);
        let dir = target.0.clone();
        let dir_is_new = {
            let mut targets = lock(&self.targets);
            if targets.target_by_path.contains_key(path) {
                return Ok(());
            }
            let dir_is_new = !targets.watches_dir(&dir);
            targets.add(path, target);
            dir_is_new
        };
        if !dir_is_new {
            return Ok(());
        }
        let result = (|| {
            if watcher.is_none() {
                *watcher = Some(self.create_watcher()?);
            }
            watcher
                .as_mut()
                .expect("created above")
                .watch(&dir, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())
        })();
        if result.is_err() {
            lock(&self.targets).remove(path);
        }
        result
    }

    /// Stops watching `path`. Unwatching a path not watched does nothing.
    pub fn unwatch(&self, path: &str) -> Result<(), String> {
        let mut watcher = lock(&self.watcher);
        let unused_dir = {
            let mut targets = lock(&self.targets);
            let Some((dir, _)) = targets.remove(path) else {
                return Ok(());
            };
            (!targets.watches_dir(&dir)).then_some(dir)
        };
        match (unused_dir, watcher.as_mut()) {
            (Some(dir), Some(watcher)) => watcher.unwatch(&dir).map_err(|e| e.to_string()),
            _ => Ok(()),
        }
    }

    /// The paths being watched, sorted.
    pub fn watched(&self) -> Vec<String> {
        let mut paths: Vec<String> = lock(&self.targets).target_by_path.keys().cloned().collect();
        paths.sort();
        paths
    }
}
