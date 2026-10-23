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
use std::sync::{Arc, Mutex, mpsc};
use serde::{Deserialize, Serialize};

use tauri::{Manager, Runtime};

const LOCK_FILE_NAME: &str = "instance.lock";
const ENDPOINT_FILE_NAME: &str = "instance.endpoint";
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(2);
const RETRY_DELAY: Duration = Duration::from_millis(20);

struct Owner {
    _lock: File,
}

// A timed-out launch stays on the startup error surface until relaunch. The
// worker keeps actual ownership through settlement, but cannot admit a normal
// session after setup has skipped its other owners.
pub struct StartupRoot(Result<PathBuf, String>);
fn establish_with_bound(
    bound: Duration,
    work: impl FnOnce() -> Result<PathBuf, String> + Send + 'static,
) -> StartupRoot {
    StartupRoot(crate::native_wait::run_with_bound("startup-owner".into(), bound, work))
}
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
fn read_frame(stream: &mut TcpStream, bound: Duration) -> std::io::Result<[u8; 8]> {
    stream.set_nonblocking(false)?;
    let deadline = Instant::now() + bound;
    let mut frame = [0; 8];
    read_before(stream, &mut frame, deadline)?;
    Ok(frame)
}

fn read_before(stream: &mut TcpStream, bytes: &mut [u8], deadline: Instant) -> std::io::Result<()> {
    let mut received = 0;
    while received < bytes.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() { return Err(std::io::ErrorKind::TimedOut.into()); }
        stream.set_read_timeout(Some(remaining))?;
        match stream.read(&mut bytes[received..]) {
            Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            Ok(count) => received += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
fn read_activation(stream: &mut TcpStream, bound: Duration) -> std::io::Result<bool> {
    read_frame(stream, bound).map(|frame| &frame == b"activate")
}

#[derive(Clone, Serialize, Deserialize)]
struct LauncherIdentity {
    port: u16,
    pid: u32,
    generation: String,
    secret: String,
    root: PathBuf,
}

fn publish_launcher(root: &Path, listener: &TcpListener) -> Result<Option<LauncherIdentity>, String> {
    let (Ok(generation), Some(file)) = (std::env::var("DROPKICK_LAUNCHER_TOKEN"), std::env::var_os("DROPKICK_LAUNCHER_ENDPOINT")) else { return Ok(None); };
    let identity = LauncherIdentity {
        port: listener.local_addr().map_err(|e| e.to_string())?.port(),
        pid: std::process::id(), generation, secret: crate::nanoid::generate(), root: root.to_path_buf(),
    };
    // This separate generation-specific descriptor is given only to a launcher
    // that started this process. Independent launches expose activation only.
    let path = PathBuf::from(file);
    let stage = path.with_extension(format!("{}.tmp", crate::nanoid::generate()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<(), String> {
        let mut file = options.open(&stage).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&identity).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&stage, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(&stage); }
    result.map(|_| Some(identity))
}

#[derive(Deserialize)]
struct CloseRequest { generation: String, secret: String, root: PathBuf }
fn authenticated_close(stream: &mut TcpStream, identity: &LauncherIdentity) -> bool {
    let deadline = Instant::now() + NOTIFY_TIMEOUT;
    let mut bytes = Vec::new();
    while bytes.len() < 1024 {
        let mut byte = [0];
        if read_before(stream, &mut byte, deadline).is_err() { return false; }
        if byte[0] == b'\n' { break; }
        bytes.push(byte[0]);
    }
    serde_json::from_slice::<CloseRequest>(&bytes).is_ok_and(|request|
        request.generation == identity.generation && request.secret == identity.secret && request.root == identity.root)
}

#[derive(Default)]
struct CloseRequests(Mutex<Option<(String, mpsc::SyncSender<bool>)>>);
#[derive(Clone, Default)]
pub struct LauncherClose(Arc<CloseRequests>);
impl LauncherClose {
    fn begin(&self) -> Option<(String, mpsc::Receiver<bool>)> {
        let mut pending = self.0.0.lock().unwrap_or_else(|e| e.into_inner());
        if pending.is_some() { return None; }
        let id = crate::nanoid::generate();
        let (sender, receiver) = mpsc::sync_channel(1);
        *pending = Some((id.clone(), sender));
        Some((id, receiver))
    }
    fn retire(&self, id: &str) {
        let mut pending = self.0.0.lock().unwrap_or_else(|e| e.into_inner());
        if pending.as_ref().is_some_and(|(current, _)| current == id) { pending.take(); }
    }
    pub fn settle(&self, allowed: bool) {
        if let Some((_, sender)) = self.0.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = sender.send(allowed);
        }
    }
}

fn listen<R: Runtime>(listener: TcpListener, app: tauri::AppHandle<R>, identity: Option<LauncherIdentity>, close: LauncherClose) {
    // The dedicated listener sleeps in accept. At most one authenticated close
    // owns a reply worker while the renderer handles ordinary save/draft questions.
    std::thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                match read_frame(&mut stream, NOTIFY_TIMEOUT) {
                    Ok(frame) if &frame == b"activate" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show(); let _ = window.set_focus();
                        }
                    }
                    Ok(frame) if &frame == b"close___" && identity.as_ref().is_some_and(|identity| authenticated_close(&mut stream, identity)) => {
                        if stream.set_write_timeout(Some(NOTIFY_TIMEOUT)).is_err() { continue; }
                        if let Some((id, result)) = close.begin() {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show(); let _ = window.set_focus();
                                if window.close().is_err() { close.settle(false); }
                            } else { close.settle(false); }
                            let close = close.clone();
                            std::thread::spawn(move || {
                                loop {
                                    let response = match result.recv_timeout(Duration::from_secs(1)) {
                                        Ok(true) => b"accepted\n".as_slice(),
                                        Ok(false) | Err(mpsc::RecvTimeoutError::Disconnected) => b"cancelled\n".as_slice(),
                                        Err(mpsc::RecvTimeoutError::Timeout) => b"pending\n".as_slice(),
                                    };
                                    if stream.write_all(response).is_err() || response != b"pending\n" { break; }
                                }
                                close.retire(&id);
                            });
                        } else { let _ = stream.write_all(b"busy\n"); }
                    }
                    _ => { let _ = stream.write_all(b"refused\n"); }
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
            let root = establish_with_bound(crate::native_wait::WAIT_BOUND, move || {
                let path = crate::paths::initialize_data_root(&handle)?;
                match claim(&path)? {
                    Claim::Primary { lock, listener } => {
                        let identity = publish_launcher(&path, &listener)?;
                        let close = LauncherClose::default();
                        handle.manage(close.clone());
                        handle.manage(Owner { _lock: lock });
                        listen(listener, handle.clone(), identity, close);
                        Ok(path)
                    }
                    Claim::Secondary { endpoint_path } => {
                        let _ = notify_primary(&endpoint_path);
                        std::process::exit(0);
                    }
                }
            });
            // Failure or timeout opens the existing error surface. All normal
            // root consumers require this admitted result before opening stores.
            app.manage(root);
            Ok(())
        })
        .build()
}

#[cfg(test)]
#[path = "../tests/unit/instance_owner.rs"]
mod tests;
