// Integration tests for the pieces of the write path that are ordinary
// functions rather than IPC commands: the digest, the temp-file naming grammar,
// the JSON classifier, the quarantine name, and write_atomic itself.
//
// The commands that wrap these keep their tests in src/lib.rs — see the comment
// on that module for why they cannot be reached from here.

use dropkick_lib::*;
use std::sync::atomic::{AtomicU32, Ordering};

// Unique temp directory per call so parallel tests never collide.
fn unique_temp_dir(label: &str) -> std::path::PathBuf {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "dropkick-test-{}-{}-{}",
        label,
        std::process::id(),
        n
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn sha256_hex_matches_known_vectors() {
    assert_eq!(
        sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn quarantine_target_is_stem_stamp_dot_invalid_beside_the_source() {
    let target = quarantine_target(std::path::Path::new("/data/state.json"));
    assert_eq!(target.parent(), Some(std::path::Path::new("/data")));
    let name = target.file_name().and_then(|n| n.to_str()).unwrap();
    // <stem>-<yyyymmdd-hhmmss-fff-utc>.invalid — one final role extension,
    // never a suffix dot-appended after the full "state.json".
    assert!(name.starts_with("state-"), "unexpected name: {name}");
    assert!(name.ends_with("-utc.invalid"), "unexpected name: {name}");
    assert!(!name.contains("state.json"), "old shape leaked in: {name}");
}

#[test]
fn classify_json_bytes_success_and_invalid() {
    let json = br#"{"version":"1.0.0","tasks":[]}"#;
    match classify_json_bytes(json) {
        JsonFileWithHashResult::Success { data, hash } => {
            assert_eq!(data.version, "1.0.0");
            assert!(data.tasks.is_empty());
            assert_eq!(hash, sha256_hex(json));
        }
        other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
    }
    assert!(matches!(
        classify_json_bytes(b"{ not json"),
        JsonFileWithHashResult::Invalid { .. }
    ));
}

fn task_json(task_id: &str, notes: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "id": task_id,
        "title": "Task",
        "description": "",
        "status": "Pending",
        "priority": "None",
        "dueDate": null,
        "createdAtUtc": "2026-08-22T00:00:00.000Z",
        "updatedAtUtc": "2026-08-22T00:00:00.000Z",
        "completedAtUtc": null,
        "notes": notes.iter().map(|id| serde_json::json!({
            "id": id,
            "content": "Note",
            "actionability": "Informational",
            "createdAtUtc": "2026-08-22T00:00:00.000Z"
        })).collect::<Vec<_>>()
    })
}

fn classify_tasks(tasks: Vec<serde_json::Value>) -> JsonFileWithHashResult {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "version": "1.0.0",
        "id": "list-1",
        "tasks": tasks
    }))
    .unwrap();
    classify_json_bytes(&bytes)
}

#[test]
fn classify_json_bytes_rejects_duplicate_task_ids() {
    assert!(matches!(
        classify_tasks(vec![task_json("task-1", &[]), task_json("task-1", &[])]),
        JsonFileWithHashResult::Invalid { .. }
    ));
}

#[test]
fn classify_json_bytes_rejects_duplicate_note_ids_within_one_task() {
    assert!(matches!(
        classify_tasks(vec![task_json("task-1", &["note-1", "note-1"])]),
        JsonFileWithHashResult::Invalid { .. }
    ));
}

#[test]
fn classify_json_bytes_allows_the_same_note_id_in_different_tasks() {
    assert!(matches!(
        classify_tasks(vec![
            task_json("task-1", &["note-1"]),
            task_json("task-2", &["note-1"])
        ]),
        JsonFileWithHashResult::Success { .. }
    ));
}

#[test]
fn atomic_temp_name_is_stem_plus_nanoid_dot_tmp() {
    // Grammar: <stem>-<nanoid>.tmp — one final extension, the target's
    // extension dropped rather than dot-appended after it.
    let name = atomic_temp_name("tasks.json");
    assert!(name.starts_with("tasks-"), "{name:?}");
    assert!(name.ends_with(".tmp"), "{name:?}");
    let discriminator = &name["tasks-".len()..name.len() - ".tmp".len()];
    // The discriminator is the Rust-core-generated nanoid: 21 characters
    // from the URL-safe alphabet (see nanoid.rs), never caller-supplied.
    assert_eq!(discriminator.len(), 21);
    assert!(discriminator
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));

    // Each call generates a fresh nanoid, so even the SAME file name
    // yields a different temp name every time.
    assert_ne!(atomic_temp_name("tasks.json"), atomic_temp_name("tasks.json"));
    // Different file names produce differently-stemmed temp names too.
    assert!(atomic_temp_name("a.json").starts_with("a-"));
    assert!(atomic_temp_name("b.json").starts_with("b-"));
}

#[test]
fn write_atomic_writes_and_replaces() {
    let dir = unique_temp_dir("write-atomic");
    let path = dir.join("f.json");
    let p = path.to_str().unwrap();

    write_atomic(p, "first").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");

    // Overwriting replaces the content atomically (rename over existing).
    // Each call generates its own fresh nanoid discriminator.
    write_atomic(p, "second longer contents").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "second longer contents");

    // No stray temp files left behind in the directory.
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
}

#[test]
fn write_atomic_returns_the_hash_of_what_it_wrote() {
    // The caller registers this digest as "the file as we last wrote it",
    // and uses it to detect a later external modification. Returning it
    // from here is what lets the caller skip reading the whole file back —
    // and what stops a concurrent writer's bytes being hashed instead.
    let dir = unique_temp_dir("write-hash");
    let path = dir.join("f.json");
    let p = path.to_str().unwrap();

    let hash = write_atomic(p, "hello").unwrap();
    assert_eq!(hash, sha256_hex(b"hello"));
    assert_eq!(hash, sha256_hex(&std::fs::read(&path).unwrap()));

    // A second write reports the new content's hash, not the old one.
    let next = write_atomic(p, "goodbye").unwrap();
    assert_ne!(next, hash);
    assert_eq!(next, sha256_hex(&std::fs::read(&path).unwrap()));
}

#[test]
fn write_atomic_errors_when_parent_missing() {
    let dir = unique_temp_dir("write-no-parent");
    let path = dir.join("missing-subdir").join("f.json");
    assert!(write_atomic(path.to_str().unwrap(), "x").is_err());
}


#[test]
#[cfg(unix)]
fn write_atomic_writes_through_a_symlink_instead_of_replacing_it() {
    // A rename replaces a directory entry, so writing to the link's own path
    // would turn the link into a regular file: every later save would land on
    // the link's former location and the real file would go permanently stale.
    // Task lists are documented as living "at any path", and symlinking one
    // into a synced folder is exactly the setup that invites.
    let dir = unique_temp_dir("symlink");
    let real = dir.join("real.json");
    let link = dir.join("link.json");
    std::fs::write(&real, "before").unwrap();
    std::os::unix::fs::symlink(&real, &link).unwrap();

    write_atomic(link.to_str().unwrap(), "after").unwrap();

    assert!(
        std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
        "the symlink must survive the save"
    );
    assert_eq!(std::fs::read_to_string(&real).unwrap(), "after");
}

#[test]
#[cfg(unix)]
fn write_atomic_keeps_the_target_permissions() {
    // File::create gives the temp file 0666 & ~umask, and the rename makes that
    // the surviving mode — so without carrying the old one over, a file the user
    // had restricted to 0600 came back readable by every local account.
    use std::os::unix::fs::PermissionsExt;

    let dir = unique_temp_dir("perms");
    let path = dir.join("private.json");
    std::fs::write(&path, "before").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

    write_atomic(path.to_str().unwrap(), "after").unwrap();

    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "permissions must survive the save");
}
