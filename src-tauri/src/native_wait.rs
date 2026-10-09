//! Native waits: IPC commands await their work's real end; main-thread callers
//! wait within a bound and keep physical ownership until the worker settles.

use std::collections::HashSet;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

pub const WAIT_BOUND: Duration = Duration::from_secs(10);
pub const EXIT_TAIL_BOUND: Duration = Duration::from_secs(3);
static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

pub fn exit_tail(work: impl FnOnce()) {
    exit_tail_with_bound(EXIT_TAIL_BOUND, || std::process::exit(0), work);
}

pub fn exit_tail_with_bound(
    bound: Duration,
    expired: impl FnOnce() + Send + 'static,
    work: impl FnOnce(),
) {
    let (done, finished) = mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("dropkick-exit-deadline".to_string())
        .spawn(move || {
            if finished.recv_timeout(bound).is_err() {
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

// A main-thread caller that stops waiting leaves its worker running; the key
// stays claimed until that worker settles, so the next write to the same
// resource is refused rather than racing it.
struct Claim(String);
impl Drop for Claim {
    fn drop(&mut self) {
        ACTIVE.get().unwrap().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

pub fn run<T: Send + 'static>(
    key: String,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    run_with_bound(key, WAIT_BOUND, work)
}

pub fn run_with_bound<T: Send + 'static>(
    key: String,
    bound: Duration,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let mut active = ACTIVE
        .get_or_init(|| Mutex::new(HashSet::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if !active.insert(key.clone()) {
        return Err("native operation remains in progress for this resource".to_string());
    }
    drop(active);
    let claim = Claim(key);
    wait(bound, move || {
        let result = work();
        drop(claim);
        result
    })
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

fn wait<T: Send + 'static>(bound: Duration, work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (done, finished) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("dropkick-native-io".to_string())
        .spawn(move || {
            let result = work();
            let _ = done.send(result);
        })
        .map_err(|e| e.to_string())?;
    finished.recv_timeout(bound).map_err(|e| match e {
        mpsc::RecvTimeoutError::Timeout => {
            "native operation timed out; its result remains unknown until it settles".to_string()
        }
        mpsc::RecvTimeoutError::Disconnected => {
            "native operation worker stopped without a result".to_string()
        }
    })?
}

#[cfg(test)]
#[path = "../tests/unit/native_wait.rs"]
mod tests;
