use super::*;
use serial_test::serial;

// The store singleton is process-global, so every test that touches it is
// marked `#[serial(backup_store)]`. `cargo test` runs tests in parallel threads
// within one process; the shared `backup_store` key makes this group (plus the
// lib.rs atomic-write test, which reaches `record` through `write_atomic`)
// mutually exclusive, so no test resets/reopens the singleton out from under
// another. Each test opens a fresh throwaway store file, exercises it, then
// closes it so the next test re-opens cleanly.

// A throwaway store file in its own temporary directory. Dropping it closes
// the singleton before the directory goes, even when an assertion fails, since
// Windows cannot remove a directory that holds an open SQLite file.
struct TempStore {
    file: PathBuf,
    _dir: tempfile::TempDir,
}

impl Drop for TempStore {
    fn drop(&mut self) {
        close_for_test();
    }
}

fn temp_store() -> TempStore {
    let dir = tempfile::tempdir().unwrap();
    TempStore {
        file: dir.path().join("backups.sqlite3"),
        _dir: dir,
    }
}

// Opens a throwaway store, runs `body` against a direct connection to the same
// file for assertions, and closes the singleton afterward.
// Serialization is provided by `#[serial(backup_store)]` on each caller, not by
// an in-module lock, so this group is also mutually exclusive with the lib.rs
// atomic-write test that shares the same key.
fn with_store<F: FnOnce(&Path)>(body: F) {
    let store = temp_store();
    init(store.file.clone());
    body(&store.file);
}

// A read-only view of every row for a path, in insert order, for assertions,
// once every queued record has been applied.
fn rows_for(file: &Path, path: &str) -> Vec<(Vec<u8>, String, i64, String)> {
    flush();
    let conn = Connection::open(file).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT content, content_sha256, byte_size, written_at_utc \
             FROM backups WHERE path = ?1 ORDER BY id ASC",
        )
        .unwrap();
    let rows = stmt
        .query_map([path], |r| {
            Ok((
                r.get::<_, Vec<u8>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    rows
}

#[test]
#[serial(backup_store)]
fn content_blob_is_byte_identical_including_crlf_and_non_utf8() {
    with_store(|file| {
        // A CR/LF pair, a UTF-8 BOM, and a lone 0xFF byte (invalid UTF-8):
        // proves the BLOB stores raw bytes, never decoded/normalized text.
        let raw: &[u8] = &[0xEF, 0xBB, 0xBF, b'a', b'\r', b'\n', b'b', 0xFF];
        let p = "/abs/doc.json";
        record(Path::new(p), raw);

        let rows = rows_for(file, p);
        assert_eq!(rows.len(), 1);
        let (content, hash, byte_size, _written) = &rows[0];
        assert_eq!(content.as_slice(), raw, "content BLOB must be byte-identical");
        assert_eq!(*byte_size, raw.len() as i64);
        assert_eq!(hash, &sha256_hex(raw), "hash is over the raw bytes");
    });
}

#[test]
#[serial(backup_store)]
fn written_at_utc_is_serialized_iso_ms_not_the_filename_stamp() {
    with_store(|file| {
        let p = "/abs/a.json";
        record(Path::new(p), b"x");
        let rows = rows_for(file, p);
        let written = &rows[0].3;
        // Serialized ISO-8601-ms shape: yyyy-mm-ddThh:mm:ss.fffZ.
        assert!(
            written.len() == 24
                && &written[4..5] == "-"
                && &written[7..8] == "-"
                && &written[10..11] == "T"
                && &written[13..14] == ":"
                && &written[16..17] == ":"
                && &written[19..20] == "."
                && written.ends_with('Z'),
            "written_at_utc {written:?} must be serialized ISO-8601-ms (2026-07-06T04:05:12.345Z)"
        );
        // Must NOT be the yyyymmdd-hhmmss-fff-utc filename stamp.
        assert!(!written.ends_with("-utc"), "must not be the filename stamp");
        assert!(!written.contains("-utc"), "must not be the filename stamp");
    });
}

#[test]
#[serial(backup_store)]
fn dedup_skips_an_unchanged_re_save() {
    with_store(|file| {
        let p = "/abs/b.json";
        record(Path::new(p), b"same");
        record(Path::new(p), b"same"); // identical -> deduped, no new row
        assert_eq!(rows_for(file, p).len(), 1, "an unchanged re-save writes no row");
    });
}

#[test]
#[serial(backup_store)]
fn a_session_keeps_one_row_per_path_with_its_latest_content() {
    with_store(|file| {
        let p = "/abs/c.json";
        record(Path::new(p), b"v1");
        record(Path::new(p), b"v2");
        record(Path::new(p), b"v3");
        let rows = rows_for(file, p);
        assert_eq!(rows.len(), 1, "one row per path per session");
        assert_eq!(rows[0].0, b"v3");
    });
}

#[test]
#[serial(backup_store)]
fn a_new_session_adds_a_row_only_for_content_that_changed() {
    let store = temp_store();
    init(store.file.clone());
    record(Path::new("/abs/d.json"), b"v1");
    record(Path::new("/abs/e.json"), b"kept");
    close_for_test();

    init(store.file.clone());
    // Equal to the previous session's last version: nothing written.
    record(Path::new("/abs/e.json"), b"kept");
    record(Path::new("/abs/d.json"), b"v2");
    let d = rows_for(&store.file, "/abs/d.json");
    assert_eq!(d.iter().map(|r| r.0.clone()).collect::<Vec<_>>(), vec![b"v1".to_vec(), b"v2".to_vec()]);
    assert_eq!(rows_for(&store.file, "/abs/e.json").len(), 1);
}

#[test]
#[serial(backup_store)]
fn a_busy_owner_queues_every_save_in_order_and_drains_on_close() {
    with_store(|file| {
        flush();
        let shared = Arc::clone(&lock().as_ref().unwrap().shared);
        // Another connection holds the write lock, so the owner's write waits on
        // it and later saves arrive behind an active write.
        let holder = Connection::open(file).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        record(Path::new("/abs/f.json"), b"active snapshot");
        {
            let state = shared.lock();
            let state = shared.changed.wait_while(state,
                |state| !(state.active && state.ready.is_empty())).unwrap_or_else(|p| p.into_inner());
            assert!(state.active && state.ready.is_empty());
        }
        let newest = [0xEF, 0xBB, 0xBF, b'\r', b'\n', 0xFF];
        record(Path::new("/abs/f.json"), b"second");
        record(Path::new("/abs/g.json"), b"other");
        record(Path::new("/abs/f.json"), &newest);
        {
            let state = shared.lock();
            assert_eq!(
                state.ready.iter().map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
                    .collect::<Vec<_>>(),
                [("/abs/f.json", b"second".as_slice()), ("/abs/g.json", b"other".as_slice()),
                    ("/abs/f.json", newest.as_slice())]);
        }
        holder.execute_batch("COMMIT").unwrap();
        drop(holder);
        close_for_test();
        assert_eq!(rows_for(file, "/abs/f.json")[0].0, newest);
        assert_eq!(rows_for(file, "/abs/g.json")[0].0, b"other");
    });
}

#[test]
#[serial(backup_store)]
fn reverting_to_an_earlier_session_still_replaces_this_sessions_changed_row() {
    let store = temp_store();
    let path = Path::new("/abs/revert.json");
    init(store.file.clone());
    record(path, b"original");
    close_for_test();
    init(store.file.clone());
    record(path, b"original");
    assert_eq!(rows_for(&store.file, path.to_str().unwrap()).len(), 1);
    record(path, b"changed this session");
    flush();
    record(path, b"original");
    let rows = rows_for(&store.file, path.to_str().unwrap());
    assert_eq!(rows.iter().map(|row| row.0.as_slice()).collect::<Vec<_>>(),
        [b"original".as_slice(), b"original".as_slice()]);
}

#[test]
#[serial(backup_store)]
fn dedup_is_per_path_not_global() {
    with_store(|file| {
        // Identical content under two different paths each records (dedup is
        // per-path against that path's latest row, never global).
        record(Path::new("/abs/x.json"), b"same");
        record(Path::new("/abs/y.json"), b"same");
        assert_eq!(rows_for(file, "/abs/x.json").len(), 1);
        assert_eq!(rows_for(file, "/abs/y.json").len(), 1);
    });
}

#[test]
#[serial(backup_store)]
fn record_is_a_silent_no_op_when_the_store_never_opened() {
    // Best-effort: with the store disabled (never init'd / closed), a record
    // call must not panic and must simply do nothing.
    close_for_test(); // ensure disabled state
    record(Path::new("/abs/whatever.json"), b"data"); // must not panic
}

#[test]
#[serial(backup_store)]
fn a_store_open_failure_disables_recording_without_panicking() {
    // A path whose parent is a file makes the initial open fail.
    let store = temp_store();
    let file_as_parent = store.file.with_file_name("not-a-dir");
    std::fs::write(&file_as_parent, b"x").unwrap(); // a regular file
    let store_file = file_as_parent.join("backups.sqlite3"); // parent is a file -> mkdir fails

    init(store_file); // open fails -> disabled, one warn logged, no panic
    record(Path::new("/abs/whatever.json"), b"data"); // silent no-op, no panic
    flush();
    close_for_test();
}

// The store's format version (store-recovery-conventions).

fn user_version(file: &Path) -> i64 {
    Connection::open(file)
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap()
}

#[test]
#[serial(backup_store)]
fn a_new_store_is_stamped_with_its_format_version() {
    with_store(|file| {
        flush();
        assert_eq!(user_version(file), 1);
    });
}

#[test]
#[serial(backup_store)]
fn an_existing_store_without_a_marker_is_left_byte_identical_and_records_nothing() {
    let store = temp_store();
    let file = &store.file;
    {
        let conn = Connection::open(file).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
    }
    let before = std::fs::read(file).unwrap();
    init(file.clone());
    record(Path::new("/abs/a.json"), b"one");
    close_for_test();
    assert_eq!(std::fs::read(file).unwrap(), before);
}

#[test]
#[serial(backup_store)]
fn a_newer_store_is_left_byte_identical_and_records_nothing() {
    let store = temp_store();
    let file = &store.file;
    {
        let conn = Connection::open(file).unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();
        conn.execute_batch("CREATE TABLE history (anything BLOB);").unwrap();
    }
    let before = std::fs::read(file).unwrap();
    init(file.clone());
    record(Path::new("/abs/a.json"), b"one");
    close_for_test();
    assert_eq!(std::fs::read(file).unwrap(), before);
}

#[test]
#[serial(backup_store)]
fn a_post_open_record_failure_does_not_fail_primary_saves_or_stop_the_owner() {
    with_store(|file| {
        flush();
        let fixture = Connection::open(file).unwrap();
        fixture.execute_batch("DROP TABLE backups").unwrap();
        let primary = file.with_file_name("authored.json");
        let path = primary.to_str().unwrap();
        crate::write_atomic(path, "first authored version").unwrap();
        flush();
        assert_eq!(std::fs::read_to_string(&primary).unwrap(), "first authored version");
        fixture.execute_batch(SCHEMA).unwrap();
        crate::write_atomic(path, "later authored version").unwrap();
        assert_eq!(rows_for(file, path)[0].0, b"later authored version");
    });
}
