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
    let json = br#"{"formatVersion":1,"id":"L1","tasks":[]}"#;
    match classify_json_bytes(json) {
        JsonFileWithHashResult::Success { data, hash } => {
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

// The task list's format version (store-recovery-conventions).
#[test]
fn a_task_list_without_a_marker_is_invalid() {
    for json in [
        &br#"{"version":"1.0.0","id":"L1","tasks":[]}"#[..],
        br#"{"id":"L1","tasks":[]}"#,
        br#"[]"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }));
    }
}

#[test]
fn a_task_list_without_its_id_is_invalid() {
    for json in [
        &br#"{"formatVersion":1,"tasks":[]}"#[..],
        br#"{"formatVersion":1,"id":"","tasks":[]}"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }));
    }
}

#[test]
fn a_current_task_list_carries_no_version_field_back_to_the_webview() {
    match classify_json_bytes(br#"{"formatVersion":1,"id":"L1","tasks":[]}"#) {
        JsonFileWithHashResult::Success { data, .. } => assert_eq!(
            serde_json::to_value(&data).unwrap(),
            serde_json::json!({ "id": "L1", "tasks": [] })
        ),
        other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
    }
}

#[test]
fn a_newer_task_list_is_reported_before_its_body_is_parsed() {
    // A newer format may reshape the body; it is still newer, not corrupt.
    match classify_json_bytes(br#"{"formatVersion":2,"items":{}}"#) {
        JsonFileWithHashResult::Newer { format_version } => assert_eq!(format_version, 2),
        other => panic!("expected Newer, got {:?}", serde_json::to_string(&other)),
    }
    assert_eq!(
        serde_json::to_value(classify_json_bytes(br#"{"formatVersion":2,"tasks":[]}"#)).unwrap(),
        serde_json::json!({ "status": "newer", "formatVersion": 2 })
    );
}

#[test]
fn a_task_list_marker_that_is_not_a_positive_integer_is_invalid() {
    for json in [
        &br#"{"formatVersion":"1","tasks":[]}"#[..],
        br#"{"formatVersion":0,"tasks":[]}"#,
        br#"{"formatVersion":null,"tasks":[]}"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }));
    }
}

fn task_json(task_id: &str, notes: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "id": task_id,
        "title": "Task",
        "description": "",
        "status": "Pending",
        "priority": "Default",
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
        "formatVersion": 1,
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
fn classify_json_bytes_rejects_a_state_value_the_app_does_not_know() {
    for (field, value) in [("status", "Archived"), ("priority", "None")] {
        let mut task = task_json("task-1", &[]);
        task[field] = serde_json::json!(value);
        assert!(
            matches!(classify_tasks(vec![task]), JsonFileWithHashResult::Invalid { .. }),
            "{field}: {value}"
        );
    }
    let mut task = task_json("task-1", &["note-1"]);
    task["notes"][0]["actionability"] = serde_json::json!("Urgent");
    assert!(matches!(classify_tasks(vec![task]), JsonFileWithHashResult::Invalid { .. }));
}

#[test]
fn classify_json_bytes_round_trips_every_known_state_value() {
    let mut tasks = Vec::new();
    for (i, (status, priority, actionability)) in [
        ("Pending", "Critical", "Informational"),
        ("Completed", "Urgent", "Actionable"),
        ("Dismissed", "Important", "Resolved"),
        ("Pending", "Default", "Informational"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut task = task_json(&format!("task-{i}"), &["note-1"]);
        task["status"] = serde_json::json!(status);
        task["priority"] = serde_json::json!(priority);
        task["notes"][0]["actionability"] = serde_json::json!(actionability);
        tasks.push(task);
    }
    let JsonFileWithHashResult::Success { data, .. } = classify_tasks(tasks.clone()) else {
        panic!("expected Success");
    };
    let returned = serde_json::to_value(&data.tasks).unwrap();
    for (i, task) in tasks.iter().enumerate() {
        for field in ["status", "priority"] {
            assert_eq!(returned[i][field], task[field]);
        }
        assert_eq!(returned[i]["notes"][0]["actionability"], task["notes"][0]["actionability"]);
    }
}

#[test]
fn classify_json_bytes_carries_a_note_edit_time_and_leaves_an_unedited_note_without_one() {
    // The field is optional: a note never edited, including every note written
    // before the field existed, reaches the webview without it rather than as null.
    let mut edited = task_json("task-1", &["note-1", "note-2"]);
    edited["notes"][0]["editedAtUtc"] = serde_json::json!("2026-10-05T01:02:03.004Z");
    let JsonFileWithHashResult::Success { data, .. } = classify_tasks(vec![edited]) else {
        panic!("expected Success");
    };
    let notes = serde_json::to_value(&data.tasks[0].notes).unwrap();
    assert_eq!(notes[0]["editedAtUtc"], "2026-10-05T01:02:03.004Z");
    assert!(notes[1].get("editedAtUtc").is_none(), "{notes}");
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

#[test]
fn write_atomic_takes_the_save_as_the_modified_time() {
    // A save changes the content, so the replace must not carry the replaced
    // file's modified time over along with the metadata it does keep.
    let dir = unique_temp_dir("mtime");
    let path = dir.join("f.json");
    std::fs::write(&path, "before").unwrap();
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_577_836_800);
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(old)
        .unwrap();

    write_atomic(path.to_str().unwrap(), "after").unwrap();

    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    assert!(modified > old, "the save must stamp its own modified time");
}

#[test]
fn an_unchanged_write_leaves_the_file_untouched_through_both_writers() {
    // A write that changes nothing is skipped (content-lifecycle-conventions,
    // Files), so the file keeps its modified time and, being the same file, its
    // identity and metadata.
    let dir = unique_temp_dir("unchanged");
    let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_577_836_800);
    let writers: [(&str, fn(&str, &str) -> Result<String, String>); 2] = [
        ("recorded.json", write_atomic),
        ("unrecorded.json", write_atomic_unrecorded),
    ];
    for (name, write) in writers {
        let path = dir.join(name);
        std::fs::write(&path, "same").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
        #[cfg(unix)]
        let inode = std::os::unix::fs::MetadataExt::ino(&std::fs::metadata(&path).unwrap());

        let hash = write(path.to_str().unwrap(), "same").unwrap();

        assert_eq!(hash, sha256_hex(b"same"));
        let metadata = std::fs::metadata(&path).unwrap();
        assert_eq!(metadata.modified().unwrap(), old, "{name} was rewritten");
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::MetadataExt::ino(&metadata), inode, "{name} was replaced");
    }
}

#[cfg(target_os = "macos")]
fn run(command: &str, args: &[&str]) -> String {
    let output = std::process::Command::new(command).args(args).output().unwrap();
    assert!(output.status.success(), "{command} {args:?}: {output:?}");
    String::from_utf8(output.stdout).unwrap()
}

#[test]
#[cfg(target_os = "macos")]
fn write_atomic_keeps_extended_attributes_finder_tags_and_the_acl() {
    // The rename replaces the inode, so without carrying them a save dropped
    // every Finder tag, extended attribute and access-control entry the user
    // had put on the task list (content-lifecycle-conventions, Files).
    let dir = unique_temp_dir("xattr-acl");
    let path = dir.join("tagged.json");
    std::fs::write(&path, "before").unwrap();
    let p = path.to_str().unwrap();
    let tags = "<plist><array><string>Red\n6</string></array></plist>";
    run("xattr", &["-w", "com.apple.metadata:_kMDItemUserTags", tags, p]);
    run("xattr", &["-w", "user.dropkick-test", "kept", p]);
    run("chmod", &["+a", "everyone allow readattr", p]);

    write_atomic(p, "after").unwrap();

    assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
    assert_eq!(
        run("xattr", &["-p", "com.apple.metadata:_kMDItemUserTags", p]).trim_end(),
        tags
    );
    assert_eq!(run("xattr", &["-p", "user.dropkick-test", p]).trim_end(), "kept");
    let acl = run("ls", &["-le", p]);
    assert!(acl.contains("everyone allow readattr"), "ACL lost: {acl}");
}

#[test]
#[cfg(target_os = "macos")]
fn write_atomic_adds_no_metadata_to_a_file_that_had_none() {
    let dir = unique_temp_dir("no-xattr");
    let path = dir.join("plain.json");
    let p = path.to_str().unwrap();
    write_atomic(p, "first").unwrap();
    write_atomic(p, "second").unwrap();
    let names = run("xattr", &[p]);
    assert!(
        !names.lines().any(|n| n.starts_with("user.") || n.contains("_kMDItemUserTags")),
        "unexpected attributes: {names}"
    );
    assert!(!run("ls", &["-le", p]).contains(" allow "), "unexpected ACL");
}
