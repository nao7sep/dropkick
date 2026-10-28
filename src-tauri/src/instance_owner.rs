//! Atomic process ownership and second-launch activation.
//!
//! The app owns whole-file task and workspace snapshots, so two GUI processes
//! must never open the same storage root concurrently. An OS file lock is the
//! authority; a loopback endpoint only asks the established owner to show and
//! focus its window. Scoping both files to `DROPKICK_DATA_DIR` keeps disposable
//! test homes independent from the normal profile.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime};

const LOCK_FILE_NAME: &str = "instance.lock";
const ENDPOINT_FILE_NAME: &str = "instance.endpoint";
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(2);
const RETRY_DELAY: Duration = Duration::from_millis(20);

struct Owner {
    _lock: File,
}

// The data root this process owns, or why it could not claim it; a failure
// opens only the startup error surface.
pub struct StartupRoot(Result<PathBuf, String>);
pub fn admitted_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.try_state::<StartupRoot>().ok_or_else(|| "storage ownership is unavailable".to_string())?.0.clone()
}

enum Claim {
    Primary { lock: File, listener: TcpListener },
    Secondary { endpoint_path: PathBuf },
}

fn claim(root: &Path) -> Result<Claim, String> {
    let path = root.join(LOCK_FILE_NAME);
    let endpoint_path = root.join(ENDPOINT_FILE_NAME);
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| {
            format!(
                "could not open process ownership file {}: {e}",
                path.display()
            )
        })?;

    match lock_file.try_lock() {
        Ok(()) => {
            let mut endpoint_file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&endpoint_path)
                .map_err(|e| e.to_string())?;
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .map_err(|e| format!("could not open process activation endpoint: {e}"))?;
            let port = listener
                .local_addr()
                .map_err(|e| format!("could not inspect process activation endpoint: {e}"))?
                .port();
            write!(endpoint_file, "{port}\n").map_err(|e| e.to_string())?;
            endpoint_file.sync_all().map_err(|e| e.to_string())?;
            Ok(Claim::Primary {
                lock: lock_file,
                listener,
            })
        }
        Err(TryLockError::WouldBlock) => Ok(Claim::Secondary { endpoint_path }),
        Err(TryLockError::Error(err)) => Err(format!(
            "could not acquire process ownership file {}: {err}",
            path.display()
        )),
    }
}

fn notify_primary(endpoint_path: &Path) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if let Ok(text) = std::fs::read_to_string(endpoint_path) {
            if let Ok(port) = text.trim().parse::<u16>() {
                if let Ok(mut stream) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)) {
                    stream.write_all(b"activate").map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
        if started.elapsed() >= NOTIFY_TIMEOUT {
            return Err("the primary instance did not expose its activation endpoint".to_string());
        }
        std::thread::sleep(RETRY_DELAY);
    }
}

// Accepted-socket mode is platform-dependent; normalize it explicitly. The
// deadline covers the complete fixed frame, including fragmented/slow input.
fn read_activation(stream: &mut TcpStream, bound: Duration) -> std::io::Result<bool> {
    stream.set_nonblocking(false)?;
    let deadline = Instant::now() + bound;
    let mut request = [0u8; 8];
    let mut received = 0;
    while received < request.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "activation frame timed out"));
        }
        stream.set_read_timeout(Some(remaining))?;
        match stream.read(&mut request[received..]) {
            Ok(0) => return Ok(false),
            Ok(count) => received += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(&request == b"activate")
}

fn listen<R: Runtime>(listener: TcpListener, app: tauri::AppHandle<R>) {
    // This dedicated worker sleeps in accept while idle, with no timer wakeups.
    std::thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                if read_activation(&mut stream, NOTIFY_TIMEOUT).unwrap_or(false) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    });
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry>::new("instance-owner")
        .setup(|app, _api| {
            let handle = app.app_handle().clone();
            let root = StartupRoot((|| {
                let path = crate::paths::initialize_data_root(&handle)?;
                match claim(&path)? {
                    Claim::Primary { lock, listener } => {
                        handle.manage(Owner { _lock: lock });
                        listen(listener, handle.clone());
                        Ok(path)
                    }
                    Claim::Secondary { endpoint_path } => {
                        let _ = notify_primary(&endpoint_path);
                        std::process::exit(0);
                    }
                }
            })());
            // Failure opens the existing error surface. All normal
            // root consumers require this admitted result before opening stores.
            app.manage(root);
            Ok(())
        })
        .build()
}

#[cfg(test)]
#[path = "../tests/unit/instance_owner.rs"]
mod tests;
