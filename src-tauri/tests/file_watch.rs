// The task-list watcher against the real filesystem: what it reports, under
// which name, and when it stops. Each wait is bounded and only runs out when a
// report never comes.

use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use dropkick_lib::file_watch::FileWatches;
use dropkick_lib::write_atomic;

const REPORT_BOUND: Duration = Duration::from_secs(10);

fn watches() -> (FileWatches, Receiver<String>) {
    let (sender, receiver) = mpsc::channel();
    let watches = FileWatches::new(move |path| {
        let _ = sender.send(path.to_string());
    });
    (watches, receiver)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// Every report up to and including the first that names `path`.
fn reports_until(receiver: &Receiver<String>, path: &str) -> Vec<String> {
    let mut seen = Vec::new();
    loop {
        let next = receiver
            .recv_timeout(REPORT_BOUND)
            .unwrap_or_else(|_| panic!("no report for {path}; saw {seen:?}"));
        let done = next == path;
        seen.push(next);
        if done {
            return seen;
        }
    }
}

#[test]
fn reports_a_write_to_the_watched_file() {
    let dir = tempfile::tempdir().unwrap();
    let list = dir.path().join("list.json");
    std::fs::write(&list, "{}").unwrap();
    let (watches, receiver) = watches();
    watches.watch(&path_string(&list)).unwrap();

    std::fs::write(&list, "{\"tasks\":[]}").unwrap();

    reports_until(&receiver, &path_string(&list));
}

#[test]
fn reports_an_atomic_replace_and_a_removal() {
    let dir = tempfile::tempdir().unwrap();
    let list = dir.path().join("list.json");
    std::fs::write(&list, "{}").unwrap();
    let list = path_string(&list);
    let (watches, receiver) = watches();
    watches.watch(&list).unwrap();

    // The app's own save is reported too; telling it apart is the window's job.
    write_atomic(&list, "{\"tasks\":[]}").unwrap();
    reports_until(&receiver, &list);

    std::fs::remove_file(&list).unwrap();
    reports_until(&receiver, &list);
}

#[test]
fn reports_only_the_watched_file_in_its_directory() {
    let dir = tempfile::tempdir().unwrap();
    let list = dir.path().join("list.json");
    let sibling = dir.path().join("other.json");
    std::fs::write(&list, "{}").unwrap();
    std::fs::write(&sibling, "{}").unwrap();
    let list = path_string(&list);
    let (watches, receiver) = watches();
    watches.watch(&list).unwrap();

    std::fs::write(&sibling, "{\"tasks\":[]}").unwrap();
    std::fs::write(&list, "{\"tasks\":[]}").unwrap();

    let seen = reports_until(&receiver, &list);
    assert!(seen.iter().all(|p| p == &list), "{seen:?}");
}

#[test]
fn stops_reporting_a_file_once_unwatched() {
    let dir = tempfile::tempdir().unwrap();
    let closed = path_string(&dir.path().join("closed.json"));
    let open = path_string(&dir.path().join("open.json"));
    std::fs::write(&closed, "{}").unwrap();
    std::fs::write(&open, "{}").unwrap();
    let (watches, receiver) = watches();
    watches.watch(&closed).unwrap();
    watches.watch(&open).unwrap();

    watches.unwatch(&closed).unwrap();
    std::fs::write(&closed, "{\"tasks\":[]}").unwrap();
    std::fs::write(&open, "{\"tasks\":[]}").unwrap();

    let seen = reports_until(&receiver, &open);
    assert!(!seen.contains(&closed), "{seen:?}");
    assert_eq!(watches.watched(), vec![open]);
}

#[test]
fn watching_twice_is_one_watch_and_unwatching_an_unknown_path_is_harmless() {
    let dir = tempfile::tempdir().unwrap();
    let list = path_string(&dir.path().join("list.json"));
    std::fs::write(&list, "{}").unwrap();
    let (watches, _receiver) = watches();

    watches.watch(&list).unwrap();
    watches.watch(&list).unwrap();
    assert_eq!(watches.watched(), vec![list.clone()]);

    watches.unwatch(&list).unwrap();
    watches.unwatch(&list).unwrap();
    assert!(watches.watched().is_empty());
}

#[test]
fn a_list_in_a_missing_directory_is_not_watched() {
    let dir = tempfile::tempdir().unwrap();
    let list = path_string(&dir.path().join("gone").join("list.json"));
    let (watches, _receiver) = watches();

    assert!(watches.watch(&list).is_err());
    assert!(watches.watched().is_empty());
}

#[cfg(unix)]
#[test]
fn reports_a_symlinked_list_under_the_path_it_was_opened_by() {
    let dir = tempfile::tempdir().unwrap();
    let real_dir = dir.path().join("synced");
    std::fs::create_dir(&real_dir).unwrap();
    let real = real_dir.join("list.json");
    let link = dir.path().join("list.json");
    std::fs::write(&real, "{}").unwrap();
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let link = path_string(&link);
    let (watches, receiver) = watches();
    watches.watch(&link).unwrap();

    std::fs::write(&real, "{\"tasks\":[]}").unwrap();

    reports_until(&receiver, &link);
}
