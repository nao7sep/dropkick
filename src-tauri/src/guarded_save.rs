//! External task-file publication owns admission, staging and displacement in
//! one worker. A failed IPC or partial replacement is not proof of no effect.
use std::{fs, io::Write, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Admission { Compare { hash: String }, Overwrite, Create }

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Outcome {
    Saved { hash: String, #[serde(rename = "recoveryPath")] recovery_path: Option<String> },
    Conflict,
    Missing,
    Unsupported,
    Failed { message: String, publication: Publication },
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Publication { Untouched, Unknown }

struct Stage { directory: PathBuf, file: PathBuf, disposable: bool }
impl Drop for Stage {
    fn drop(&mut self) {
        if self.disposable { let _ = fs::remove_file(&self.file); let _ = fs::remove_dir(&self.directory); }
    }
}
#[cfg(test)]
thread_local! { static READS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    #[cfg(test)] READS.with(|count| count.set(count.get() + 1));
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
fn admit_format(path: &Path, bytes: Option<&[u8]>, writing: Option<u64>) -> Result<(), String> {
    if let (Some(current), Some(bytes)) = (writing, bytes) {
        if let Some(found) = crate::format_version::stamped(bytes) {
            if found > current { return Err(crate::format_version::newer_than_message(path, found, current)); }
        }
    }
    Ok(())
}

pub fn save(path: &str, contents: &str, admission: Admission) -> Outcome {
    save_with(path, contents, admission, qualified, |_, _| {}, |_, _| {})
}

// Hooks exercise actual competing filesystem writes at both publication
// boundaries without sleeping, changing user files or replacing the primitive.
fn save_with(path: &str, contents: &str, admission: Admission,
    qualify: impl FnOnce(&Path) -> bool,
    staged: impl FnOnce(&Path, &Path), late: impl FnOnce(&Path, &Path)) -> Outcome {
    let mut publication = Publication::Untouched;
    let result = (|| -> Result<Outcome, String> {
        let target = crate::resolve_symlink(Path::new(path))?;
        let parent = target.parent().ok_or("save target has no parent")?;
        let name = target.file_name().and_then(|s| s.to_str()).ok_or("save target has no name")?;
        let writing = crate::format_version::stamped(contents.as_bytes());
        let initial = read(&target)?;
        admit_format(&target, initial.as_deref(), writing)?;
        match &admission {
            Admission::Compare { hash } => match initial.as_ref() {
                None => return Ok(Outcome::Missing),
                Some(bytes) if crate::sha256_hex(bytes) != *hash => return Ok(Outcome::Conflict),
                _ => {},
            },
            Admission::Create if initial.is_some() => return Ok(Outcome::Conflict),
            _ => {},
        }
        let hash = crate::sha256_hex(contents.as_bytes());
        if initial.as_deref() == Some(contents.as_bytes()) {
            return Ok(Outcome::Saved { hash, recovery_path: None });
        }
        if initial.is_some() && !qualify(parent) { return Ok(Outcome::Unsupported); }
        let directory = parent.join(crate::atomic_temp_name(name));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)] { use std::os::unix::fs::DirBuilderExt; builder.mode(0o700); }
        builder.create(&directory).map_err(|e| e.to_string())?;
        let mut stage = Stage { file: directory.join(name), directory, disposable: true };
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&stage.file).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        crate::carry_replaced_permissions(&target, &file).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        staged(&target, &stage.file);
        let final_bytes = read(&target)?;
        admit_format(&target, final_bytes.as_deref(), writing)?;
        if final_bytes != initial { return Ok(if final_bytes.is_none() { Outcome::Missing } else { Outcome::Conflict }); }
        drop(final_bytes);
        late(&target, &stage.file);
        let displaced = if initial.is_some() {
            // Once replacement starts, an unexpected error or panic must keep
            // every available copy. Only a proven untouched error allows cleanup.
            stage.disposable = false;
            publication = Publication::Unknown;
            match exchange(&stage.file, &target) {
                Ok(displaced) => Some(displaced),
                Err((error, outcome)) => {
                    publication = outcome;
                    stage.disposable = outcome == Publication::Untouched;
                    if error.kind() == std::io::ErrorKind::Unsupported && stage.disposable { return Ok(Outcome::Unsupported); }
                    return Err(if stage.disposable { error.to_string() } else { format!("{error}; publication uncertain; inspect staging: {}", stage.directory.display()) });
                }
            }
        } else {
            stage.disposable = false;
            publication = Publication::Unknown;
            if let Err(error) = crate::publish_new(&stage.file, &target) {
                publication = publication_failure(&error);
                stage.disposable = publication == Publication::Untouched;
                return Err(if stage.disposable { error.to_string() } else { format!("{error}; publication uncertain; inspect staging: {}", stage.directory.display()) });
            }
            stage.disposable = true;
            None
        };
        // No failure after known publication is presented as an untouched save.
        let mut recovery_path = None;
        if let Some(displaced) = displaced {
            match read(&displaced) {
                Ok(Some(bytes)) if Some(bytes.as_slice()) == initial.as_deref() => {
                    let _ = fs::remove_file(&displaced);
                    let _ = fs::remove_dir(&stage.directory);
                },
                _ => {
                    let stem = target.file_stem().and_then(|s| s.to_str()).unwrap_or("tasks");
                    let recovery = parent.join(format!("{stem}-{}-{}.recovered.json", crate::logging::filename_stamp_seconds_now(), crate::nanoid::generate()));
                    let kept = if crate::publish_new(&displaced, &recovery).is_ok() { recovery } else { displaced };
                    recovery_path = Some(kept.to_string_lossy().into_owned());
                    let _ = fs::remove_dir(&stage.directory);
                }
            }
        }
        if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); }
        crate::backup_store::record(&target, contents.as_bytes());
        Ok(Outcome::Saved { hash, recovery_path })
    })();
    result.unwrap_or_else(|message| Outcome::Failed { message, publication })
}

// Namespace refusal errors establish no publication. An I/O error may follow
// a device-side effect, so preserve staging and never authorize compensation.
fn publication_failure(error: &std::io::Error) -> Publication {
    use std::io::ErrorKind::*;
    match error.kind() {
        AlreadyExists | NotFound | PermissionDenied | Unsupported | InvalidInput => Publication::Untouched,
        _ => Publication::Unknown,
    }
}

#[cfg(target_os = "macos")]
fn qualified(parent: &Path) -> bool {
    use std::{ffi::{CString, CStr}, os::unix::ffi::OsStrExt};
    let Ok(path) = CString::new(parent.as_os_str().as_bytes()) else { return false; };
    let mut facts = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // Local APFS is the volume family exercised by the native displacement
    // fixtures. Network/sync providers are not inferred safe from rename alone.
    unsafe {
        if libc::statfs(path.as_ptr(), facts.as_mut_ptr()) != 0 { return false; }
        let facts = facts.assume_init();
        facts.f_flags & libc::MNT_LOCAL as u32 != 0 && CStr::from_ptr(facts.f_fstypename.as_ptr()).to_bytes() == b"apfs"
    }
}
#[cfg(not(target_os = "macos"))]
fn qualified(_parent: &Path) -> bool {
    // Windows replacement is implemented and directly testable below, but
    // production replacement remains refused until native fleet qualification.
    false
}

#[cfg(target_os = "macos")]
fn exchange(staged: &Path, target: &Path) -> Result<PathBuf, (std::io::Error, Publication)> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    extern "C" { fn renamex_np(from: *const std::ffi::c_char, to: *const std::ffi::c_char, flags: u32) -> i32; }
    let from = CString::new(staged.as_os_str().as_bytes()).map_err(|e| (e.into(), Publication::Untouched))?;
    let to = CString::new(target.as_os_str().as_bytes()).map_err(|e| (e.into(), Publication::Untouched))?;
    if unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 2) } == 0 { Ok(staged.to_path_buf()) }
    else {
        let error = std::io::Error::last_os_error();
        let publication = publication_failure(&error);
        Err((error, publication))
    }
}
#[cfg(windows)]
fn exchange(staged: &Path, target: &Path) -> Result<PathBuf, (std::io::Error, Publication)> {
    let displaced = staged.with_file_name(format!("displaced-{}", crate::nanoid::generate()));
    crate::windows_replace::replace_file_preserving(staged, target, &displaced)
        .map(|()| displaced)
        .map_err(|error| { let outcome = windows_failure(error.raw_os_error()); (error, outcome) })
}
// With a backup name, these documented failures keep both original names.
// All other failures, especially 1177, preserve evidence and forbid compensation.
#[cfg(any(windows, test))]
fn windows_failure(code: Option<i32>) -> Publication {
    match code { Some(1175 | 1176) => Publication::Untouched, _ => Publication::Unknown }
}
#[cfg(not(any(target_os = "macos", windows)))]
fn exchange(_: &Path, _: &Path) -> Result<PathBuf, (std::io::Error, Publication)> {
    Err((std::io::ErrorKind::Unsupported.into(), Publication::Untouched))
}

#[cfg(test)]
#[path = "../tests/unit/guarded_save.rs"]
mod tests;
