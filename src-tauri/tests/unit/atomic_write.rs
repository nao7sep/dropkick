// Tests for the pieces of the write path that are ordinary
// functions rather than IPC commands: the digest, the temp-file naming grammar,
// the JSON classifier, and write_atomic itself.
// The commands that wrap them are tested in tests/unit/lib.rs.

use crate::*;

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
fn classify_json_bytes_success_and_invalid() {
    let json = br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"L1","tasks":[]}"#;
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

// The task list's format version (store-recovery-conventions). A `version`
// label is not a marker, so a list carrying one instead is refused.
#[test]
fn a_task_list_without_a_marker_is_invalid() {
    for json in [
        &br#"{"version":"1.0.0","id":"L1","tasks":[]}"#[..],
        br#"{"version":"1.0.0","tasks":[]}"#,
        br#"{"version":"1.0.1","id":"L1","tasks":[]}"#,
        br#"{"id":"L1","tasks":[]}"#,
        br#"[]"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }));
    }
}

#[test]
fn a_task_list_without_its_id_is_invalid() {
    for json in [
        &br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"tasks":[]}"#[..],
        br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"","tasks":[]}"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }));
    }
}

// The file identity header: a list must name dropkick and task-list with a
// positive integer version. Another owner or kind, or a missing or malformed
// header, is unreadable.
#[test]
fn a_task_list_without_its_header_or_of_another_format_is_invalid() {
    for json in [
        &br#"{"id":"L1","tasks":[]}"#[..],
        br#"{"format":"task-list","id":"L1","tasks":[]}"#,
        br#"{"format":{"kind":"task-list","version":1},"id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","version":1},"id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"bigmouth","kind":"task-list","version":1},"id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","kind":"workspace","version":1},"id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","kind":"workspace","version":2},"id":"L1","tasks":[]}"#,
        br#"{"formatVersion":1,"id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","kind":"taskList","version":1},"id":"L1","tasks":[]}"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Invalid { .. }), "{}", String::from_utf8_lossy(json));
    }
}

// `writer` is never read: a list without one, or with any value, is read.
#[test]
fn a_task_list_is_read_whatever_its_writer_holds() {
    for json in [
        &br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"id":"L1","tasks":[]}"#[..],
        br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":"anything","id":"L1","tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","kind":"task-list","version":1,"extra":true},"writer":{"name":"other"},"id":"L1","tasks":[]}"#,
    ] {
        assert!(matches!(classify_json_bytes(json), JsonFileWithHashResult::Success { .. }), "{}", String::from_utf8_lossy(json));
    }
}

#[test]
fn a_current_task_list_carries_no_header_field_back_to_the_webview() {
    match classify_json_bytes(br#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"L1","tasks":[]}"#) {
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
    match classify_json_bytes(br#"{"format":{"owner":"dropkick","kind":"task-list","version":2},"writer":{"name":"dropkick","version":"1.0.0"},"items":{}}"#) {
        JsonFileWithHashResult::Newer { format_version } => assert_eq!(format_version, 2),
        other => panic!("expected Newer, got {:?}", serde_json::to_string(&other)),
    }
    assert_eq!(
        serde_json::to_value(classify_json_bytes(br#"{"format":{"owner":"dropkick","kind":"task-list","version":2},"writer":{"name":"dropkick","version":"1.0.0"},"tasks":[]}"#)).unwrap(),
        serde_json::json!({ "status": "newer", "formatVersion": 2 })
    );
}

#[test]
fn a_task_list_marker_that_is_not_a_positive_integer_is_invalid() {
    for json in [
        &br#"{"format":{"owner":"dropkick","kind":"task-list","version":"1"},"writer":{"name":"dropkick","version":"1.0.0"},"tasks":[]}"#[..],
        br#"{"format":{"owner":"dropkick","kind":"task-list","version":0},"writer":{"name":"dropkick","version":"1.0.0"},"tasks":[]}"#,
        br#"{"format":{"owner":"dropkick","kind":"task-list","version":null},"writer":{"name":"dropkick","version":"1.0.0"},"tasks":[]}"#,
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

#[test]
fn consumed_identities_and_required_nullable_members_are_validated() {
    for invalid in ["", "task:note", "task#title"] {
        let value =
            serde_json::json!({"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"L1","tasks":[task_json(invalid, &[])]});
        assert!(matches!(
            classify_json_bytes(value.to_string().as_bytes()),
            JsonFileWithHashResult::Invalid { .. }
        ));
        let value =
            serde_json::json!({"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"L1","tasks":[task_json("t1", &[invalid])]});
        assert!(matches!(
            classify_json_bytes(value.to_string().as_bytes()),
            JsonFileWithHashResult::Invalid { .. }
        ));
    }
    for field in ["dueDate", "completedAtUtc"] {
        let mut task = task_json("t1", &[]);
        task.as_object_mut().unwrap().remove(field);
        let value = serde_json::json!({"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"L1","tasks":[task]});
        assert!(matches!(
            classify_json_bytes(value.to_string().as_bytes()),
            JsonFileWithHashResult::Invalid { .. }
        ));
    }
}

#[test]
fn native_publication_preserves_a_newer_document_even_for_equal_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("managed.json");
    let bytes = r#"{"format":{"owner":"dropkick","kind":"task-list","version":2},"writer":{"name":"dropkick","version":"1.0.0"},"newField":"keep"}"#;
    std::fs::write(&path, bytes).unwrap();
    assert!(write_atomic(path.to_str().unwrap(), r#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"}}"#).is_err());
    assert!(write_atomic_unrecorded(path.to_str().unwrap(), r#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"newField":"keep"}"#).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), bytes);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

// Each write is judged against its own format's version, which it stamps, not
// against one shared number.
#[test]
fn a_write_is_judged_against_the_version_it_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.json");
    let p = path.to_str().unwrap();
    std::fs::write(&path, r#"{"format":{"owner":"dropkick","kind":"task-list","version":3},"writer":{"name":"dropkick","version":"1.0.0"}}"#).unwrap();
    assert!(write_atomic(p, r#"{"format":{"owner":"dropkick","kind":"task-list","version":2},"writer":{"name":"dropkick","version":"1.0.0"}}"#).is_err());
    write_atomic(p, r#"{"format":{"owner":"dropkick","kind":"task-list","version":3},"writer":{"name":"dropkick","version":"1.0.0"},"x":1}"#).unwrap();
}

#[test]
#[cfg_attr(not(unix), ignore = "Unix only: checks POSIX create mode")]
fn a_new_published_document_uses_the_ordinary_create_mode() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ordinary = dir.path().join("ordinary.json");
        std::fs::write(&ordinary, "ordinary").unwrap();
        let target = dir.path().join("published.json");
        write_atomic_unrecorded(target.to_str().unwrap(), "published").unwrap();
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            std::fs::metadata(&ordinary).unwrap().permissions().mode() & 0o777);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}

fn classify_tasks(tasks: Vec<serde_json::Value>) -> JsonFileWithHashResult {
    let bytes = serde_json::to_vec(&serde_json::json!({
        "format": { "owner": "dropkick", "kind": "task-list", "version": 1 },
        "writer": { "name": "dropkick", "version": "1.0.0" },
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
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
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
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
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
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let path = dir.join("missing-subdir").join("f.json");
    assert!(write_atomic(path.to_str().unwrap(), "x").is_err());
}

#[test]
#[cfg_attr(not(windows), ignore = "Windows only: holds the target open without FILE_SHARE_DELETE")]
fn write_atomic_preserves_a_target_open_without_delete_sharing() {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tasks.json");
        let original = r#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"list","tasks":[]}"#;
        std::fs::write(&path, original).unwrap();
        // FILE_SHARE_READ | FILE_SHARE_WRITE, deliberately no FILE_SHARE_DELETE:
        // another program can read the list but prevents its atomic replacement.
        let held = std::fs::OpenOptions::new().read(true).share_mode(0x00000003)
            .open(&path).unwrap();
        assert!(write_atomic(path.to_str().unwrap(), r#"{"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},"id":"changed","tasks":[]}"#).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "staging must be cleaned up");
        drop(held);
    }
}


#[test]
#[cfg(any(unix, windows))]
fn write_atomic_writes_through_a_symlink_instead_of_replacing_it() {
    // A rename replaces a directory entry, so writing to the link's own path
    // would turn the link into a regular file: every later save would land on
    // the link's former location and the real file would go permanently stale.
    // Task lists are documented as living "at any path", and symlinking one
    // into a synced folder is exactly the setup that invites.
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    let real = dir.join("real.json");
    let link = dir.join("link.json");
    std::fs::write(&real, "before").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&real, &link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&real, &link)
        .expect("Windows symlink test requires Developer Mode or symlink creation privilege");

    write_atomic(link.to_str().unwrap(), "after").unwrap();

    assert!(
        std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
        "the symlink must survive the save"
    );
    assert_eq!(std::fs::read_to_string(&real).unwrap(), "after");
}

#[cfg(any(unix, windows))]
fn file_symlink(target: &std::path::Path, link: &std::path::Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(target, link)
        .expect("Windows symlink test requires Developer Mode or symlink creation privilege");
}

#[cfg(any(unix, windows))]
#[test]
fn write_atomic_follows_a_readable_long_symlink_chain_without_replacing_any_link() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("target.json");
    std::fs::write(&target, "before").unwrap();
    let mut previous = target.clone();
    let mut links = Vec::new();
    for index in 0..12 {
        let link = dir.path().join(format!("link-{index}.json"));
        file_symlink(std::path::Path::new(previous.file_name().unwrap()), &link);
        previous = link.clone();
        links.push(link);
    }
    assert_eq!(std::fs::read_to_string(&previous).unwrap(), "before");
    write_atomic_unrecorded(previous.to_str().unwrap(), "after").unwrap();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "after");
    assert!(links.iter().all(|link| std::fs::symlink_metadata(link).unwrap().file_type().is_symlink()));
}

#[cfg(any(unix, windows))]
#[test]
fn write_atomic_refuses_a_link_loop_without_replacing_it() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a.json");
    let b = dir.path().join("b.json");
    file_symlink(std::path::Path::new("b.json"), &a);
    file_symlink(std::path::Path::new("a.json"), &b);
    assert!(write_atomic_unrecorded(a.to_str().unwrap(), "after").is_err());
    assert_eq!(std::fs::read_link(&a).unwrap(), std::path::PathBuf::from("b.json"));
    assert_eq!(std::fs::read_link(&b).unwrap(), std::path::PathBuf::from("a.json"));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[test]
#[cfg_attr(not(unix), ignore = "Unix only: checks carried POSIX mode bits")]
fn write_atomic_keeps_the_target_permissions() {
    #[cfg(unix)]
    {
        // File::create gives the temp file 0666 & ~umask, and the rename makes that
        // the surviving mode — so without carrying the old one over, a file the user
        // had restricted to 0600 came back readable by every local account.
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let path = dir.join("private.json");
        std::fs::write(&path, "before").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomic(path.to_str().unwrap(), "after").unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "permissions must survive the save");
    }
}

#[test]
fn write_atomic_takes_the_save_as_the_modified_time() {
    // A save changes the content, so the replace must not carry the replaced
    // file's modified time over along with the metadata it does keep.
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
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
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
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

#[test]
fn document_admission_checks_calendar_dates_and_every_timestamp_field() {
    for invalid in ["2025-02-29", "2026-04-31", "2026-1-01", "2026-00-01", "2026-01-00"] {
        let mut task = task_json("t1", &[]);
        task["dueDate"] = json!(invalid);
        assert!(matches!(classify_tasks(vec![task]), JsonFileWithHashResult::Invalid { message } if message.contains("dueDate")));
    }
    for field in ["createdAtUtc", "updatedAtUtc", "completedAtUtc"] {
        for invalid in ["2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00", "2026-01-01T00:00:00+09:00", "2026-01-01T00:00:00.Z", "2026-01-01T00:00:00.12345678Z", "日付が不正です"] {
            let mut task = task_json("t1", &[]);
            task[field] = json!(invalid);
            assert!(matches!(classify_tasks(vec![task]), JsonFileWithHashResult::Invalid { message } if message.contains(field)), "{field}: {invalid}");
        }
    }
    for field in ["createdAtUtc", "editedAtUtc"] {
        let mut task = task_json("t1", &["n1"]);
        task["notes"][0][field] = json!("ambiguous date");
        assert!(matches!(classify_tasks(vec![task]), JsonFileWithHashResult::Invalid { message } if message.contains(field) && message.contains("n1")));
    }
}

#[test]
fn document_admission_preserves_supported_utc_precision_and_legacy_dates() {
    for suffix in ["Z", "+00:00"] {
        for fraction in ["", ".1", ".12", ".123", ".1234", ".12345", ".123456", ".1234567"] {
            let stamp = format!("2024-02-29T23:59:59{fraction}{suffix}");
            let mut task = task_json("t1", &["n1"]);
            task["dueDate"] = json!("2000-02-29");
            for field in ["createdAtUtc", "updatedAtUtc", "completedAtUtc"] { task[field] = json!(stamp); }
            task["notes"][0]["createdAtUtc"] = json!(stamp);
            task["notes"][0]["editedAtUtc"] = json!(stamp);
            let document = json!({"format":{"owner":"dropkick","kind":"task-list","version":1},"writer":{"name":"dropkick","version":"1.0.0"},  "id":"L1", "tasks":[task]});
            match classify_json_bytes(document.to_string().as_bytes()) {
                JsonFileWithHashResult::Success { data, .. } => assert_eq!(data.tasks[0].created_at_utc, stamp),
                _ => panic!("rejected {stamp}"),
            }
        }
    }
}
