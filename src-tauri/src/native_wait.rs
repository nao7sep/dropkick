//! Native waits: IPC commands await their work's real end, and the exit
//! sequence as a whole has one deadline.

use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

/// The exit deadline's length when nothing fixed it earlier. The main window
/// fixes the deadline when its close starts and the end of an OS session fixes
/// it when the session-end wait starts, so this applies only to an exit that
/// began some other way.
pub const EXIT_TAIL_BOUND: Duration = Duration::from_secs(3);

// The quit's one deadline, set by the code that starts the quit (the main
// window's close_window, or the session-end wait) and read by the exit tail.
// Only the main thread sets it; the Mutex is what Rust requires to share it.
static EXIT_DEADLINE: Mutex<Option<Instant>> = Mutex::new(None);

/// Fixes the exit deadline; a later quit fixes its own.
pub fn set_exit_deadline(deadline: Instant) {
    *EXIT_DEADLINE.lock().unwrap_or_else(|e| e.into_inner()) = Some(deadline);
}

fn exit_deadline() -> Instant {
    EXIT_DEADLINE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .unwrap_or_else(|| Instant::now() + EXIT_TAIL_BOUND)
}

/// Runs the exit's last steps; the process exits at the deadline if they have
/// not finished, so each step draws on what remains with no wait of its own.
pub fn exit_tail(work: impl FnOnce()) {
    exit_tail_until(exit_deadline(), || std::process::exit(0), work);
}

pub fn exit_tail_until(
    deadline: Instant,
    expired: impl FnOnce() + Send + 'static,
    work: impl FnOnce(),
) {
    let (done, finished) = mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("dropkick-exit-deadline".to_string())
        .spawn(move || {
            if finished.recv_timeout(remaining(deadline)).is_err() {
                expired();
            }
        })
        .is_err()
    {
        std::process::exit(0);
    }
    work();
    let _ = done.send(());
}

/// What remains of a deadline, zero once it has passed.
fn remaining(deadline: Instant) -> Duration {
    deadline.saturating_duration_since(Instant::now())
}

// Runs an IPC command's blocking work on the runtime's blocking pool and awaits
// its real result. The webview never blocks on a command, so no caller needs a
// bound: a slow save stays pending while later edits queue behind it per file
// (the frontend's withSerial), and the quit flow bounds the close. With no
// timeout, no outcome is ever unknown, so nothing has to compensate for one.
pub async fn settle<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "../tests/unit/native_wait.rs"]
mod tests;
