//! Files the core refused while starting (store-recovery-conventions, What a
//! refused file does): a window placement or a side store that a newer build
//! wrote, or a side store that could not be read. The frontend collects them
//! with its own refusals once both side stores have opened, stops the launch
//! for any newer file, and shows a notice for a side store that is off. A
//! refused file is left exactly as it is.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    Newer,
    Unreadable,
}

/// Which of the core's files was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Store {
    WindowPlacement,
    Records,
    Backups,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub file: String,
    pub reason: Reason,
    pub store: Store,
}

static REFUSED: Mutex<Vec<Refusal>> = Mutex::new(Vec::new());
static STOPPED: AtomicBool = AtomicBool::new(false);

pub fn note(file: &std::path::Path, reason: Reason, store: Store) {
    let refusal = Refusal { file: file.to_string_lossy().into_owned(), reason, store };
    let mut refused = REFUSED.lock().unwrap_or_else(|e| e.into_inner());
    if !refused.contains(&refusal) {
        refused.push(refusal);
    }
}

pub fn all() -> Vec<Refusal> {
    REFUSED.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The frontend stopped the launch: nothing is saved for the rest of the
/// process, so quitting from the stop message writes no file.
pub fn stop_launch() {
    STOPPED.store(true, Ordering::Relaxed);
}

pub fn launch_stopped() -> bool {
    STOPPED.load(Ordering::Relaxed)
}
