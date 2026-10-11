use super::*;
use std::fs;

fn preferences() -> Value { json!({ "formatVersion": 1, "id": "p", "name": "Settings" }) }
fn workspace() -> Value { json!({ "formatVersion": 1, "id": "w", "name": "Work", "openTabs": [], "recentFiles": [] }) }
fn tasks() -> Value { json!({ "formatVersion": 1, "id": "t", "tasks": [] }) }

#[test]
#[serial_test::serial(backup_store)]
fn creates_new_documents_and_opens_the_optional_list_in_the_workspace() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("chosen");
    let result = create(&directory, preferences(), workspace(), Some(tasks()), "Tasks").unwrap();
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 3);
    let stored: Value = serde_json::from_slice(&fs::read(&result.workspace_path).unwrap()).unwrap();
    assert_eq!(stored["openTabs"], json!([{
        "filePath": result.task_list_path.unwrap(), "displayName": "Tasks", "isUnifiedView": false,
    }]));
    assert_eq!(serde_json::from_slice::<Value>(&fs::read(&result.preferences_path).unwrap()).unwrap(), preferences());
}

#[test]
#[serial_test::serial(backup_store)]
fn skipping_the_optional_list_creates_only_the_two_documents() {
    let root = tempfile::tempdir().unwrap();
    let result = create(root.path(), preferences(), workspace(), None, "unused").unwrap();
    assert!(result.task_list_path.is_none());
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
    assert_eq!(serde_json::from_slice::<Value>(&fs::read(result.workspace_path).unwrap()).unwrap(), workspace());
}

#[test]
#[serial_test::serial(backup_store)]
fn a_late_collision_keeps_completed_documents_and_the_other_writers_bytes() {
    let root = tempfile::tempdir().unwrap();
    let result = create_with_writer(root.path(), preferences(), workspace(), Some(tasks()), "Tasks", |path, contents| {
        if path.file_name().unwrap() == "workspace.json" {
            // Another writer wins after preflight and the first two publications.
            fs::write(path, "other workspace").unwrap();
        }
        crate::write_atomic_impl(path.to_str().unwrap(), contents, true, true).map(|_| ())
    });
    assert!(result.is_err());
    assert_eq!(serde_json::from_slice::<Value>(&fs::read(root.path().join("preferences.json")).unwrap()).unwrap(), preferences());
    assert_eq!(serde_json::from_slice::<Value>(&fs::read(root.path().join("tasks.json")).unwrap()).unwrap(), tasks());
    assert_eq!(fs::read_to_string(root.path().join("workspace.json")).unwrap(), "other workspace");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 3);
}

#[test]
#[serial_test::serial(backup_store)]
fn newly_created_documents_enter_backup_history_with_the_exact_published_bytes() {
    struct Close;
    impl Drop for Close { fn drop(&mut self) { crate::backup_store::close_for_test(); } }
    let root = tempfile::tempdir().unwrap();
    let history = root.path().join("history.sqlite3");
    crate::backup_store::init(history.clone());
    let _close = Close;
    let directory = root.path().join("documents");
    let paths = create(&directory, preferences(), workspace(), Some(tasks()), "Tasks").unwrap();
    assert!(crate::backup_store::flush(std::time::Duration::from_secs(10)));
    let connection = rusqlite::Connection::open(history).unwrap();
    for path in [paths.preferences_path, paths.workspace_path, paths.task_list_path.unwrap()] {
        let bytes: Vec<u8> = connection.query_row("SELECT content FROM backups WHERE path = ?1", [&path], |row| row.get(0)).unwrap();
        assert_eq!(bytes, fs::read(path).unwrap());
    }
}

#[test]
fn any_occupied_target_prevents_predictable_partial_setup() {
    for filename in ["preferences.json", "workspace.json", "tasks.json"] {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(filename);
        fs::write(&path, "existing user bytes").unwrap();
        let error = create(root.path(), preferences(), workspace(), Some(tasks()), "Tasks").unwrap_err();
        assert_eq!(error.code, "occupied");
        assert_eq!(fs::read_to_string(&path).unwrap(), "existing user bytes");
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }
}

#[test]
fn publication_refuses_a_target_that_arrived_after_staging() {
    let root = tempfile::tempdir().unwrap();
    let staged = root.path().join("stage");
    let target = root.path().join("target");
    fs::write(&staged, "new").unwrap();
    fs::write(&target, "racing writer").unwrap();
    assert!(crate::publish_new(&staged, &target).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "racing writer");
    assert_eq!(fs::read_to_string(&staged).unwrap(), "new");
}

#[test]
fn create_only_writer_refuses_even_identical_existing_bytes_and_cleans_its_stage() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("preferences.json");
    fs::write(&path, "same").unwrap();
    assert!(crate::write_atomic_impl(path.to_str().unwrap(), "same", true, true).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "same");
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn create_only_writer_never_follows_an_existing_symlink() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("target.json");
    let link = root.path().join("preferences.json");
    fs::write(&target, "original").unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(crate::write_atomic_impl(link.to_str().unwrap(), "new", true, true).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "original");
    assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
    assert_eq!(fs::read_dir(root.path()).unwrap().count(), 2);
}

#[test]
fn relative_setup_locations_are_rejected_before_writing() {
    assert!(create(Path::new("relative"), preferences(), workspace(), None, "unused").is_err());
}
