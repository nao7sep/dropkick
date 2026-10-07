//! Bounded native waits with physical ownership retained until the worker settles.

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

pub const WAIT_BOUND: Duration = Duration::from_secs(10);
pub const EXIT_TAIL_BOUND: Duration = Duration::from_secs(3);
static ACTIVE: OnceLock<Mutex<HashMap<String, (bool, usize)>>> = OnceLock::new();

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

struct Claim { key: String, writing: bool }
impl Drop for Claim {
    fn drop(&mut self) {
        let mut active = ACTIVE.get().unwrap().lock().unwrap_or_else(|e| e.into_inner());
        if let Some((writing, readers)) = active.get_mut(&self.key) {
            if self.writing { *writing = false; } else { *readers -= 1; }
            if !*writing && *readers == 0 { active.remove(&self.key); }
        }
    }
}

pub fn run<T: Send + 'static>(
    key: String,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    run_with_bound(key, WAIT_BOUND, work)
}

pub fn read_keyed<T: Send + 'static>(key: String, work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    claimed_wait(key, false, WAIT_BOUND, work)
}

pub fn run_with_bound<T: Send + 'static>(
    key: String,
    bound: Duration,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    claimed_wait(key, true, bound, work)
}

fn claimed_wait<T: Send + 'static>(key: String, writing: bool, bound: Duration, work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let mut active = ACTIVE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let access = active.entry(key.clone()).or_default();
    if access.0 || (writing && access.1 > 0) {
        return Err("native operation remains in progress for this resource".to_string());
    }
    if writing { access.0 = true; } else { access.1 += 1; }
    drop(active);
    let claim = Claim { key, writing };
    wait(bound, move || {
        let result = work();
        drop(claim);
        result
    })
}

pub fn read<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    wait(WAIT_BOUND, work)
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
