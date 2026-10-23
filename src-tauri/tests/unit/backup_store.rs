use super::*;
use std::time::Duration;
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
    assert!(flush(Duration::from_secs(10)), "queued records were not applied");
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

// Wait for the worker's actual ownership transition, with a watchdog only to
// report a stuck worker. No assertion depends on how fast scheduling or I/O is.
fn wait_until_active(shared: &Shared, generation: u64) {
    let state = shared.lock();
    let (state, _) = shared.changed.wait_timeout_while(
        state,
        Duration::from_secs(10),
        |state| state.active != Some(generation),
    ).unwrap_or_else(|p| p.into_inner());
    assert_eq!(state.active, Some(generation));
}

#[test]
#[serial(backup_store)]
fn a_paused_owner_coalesces_pending_bytes_with_the_store_locked_and_drains_on_close() {
    with_store(|file| {
        assert!(flush(Duration::from_secs(10)));
        let shared = Arc::clone(&lock().as_ref().unwrap().shared);
        let holder = Connection::open(file).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        // Hold admission before I/O: no amount of test scheduling can outlast
        // SQLite's busy timeout and accidentally settle the active snapshot.
        let (release, pause) = std::sync::mpsc::channel();
        *shared.pause_before_record.lock().unwrap() = Some(pause);
        record(Path::new("/abs/f.json"), b"active snapshot");
        wait_until_active(&shared, 1);

        record(Path::new("/abs/f.json"), b"first pending");
        record(Path::new("/abs/g.json"), b"other first");
        let target = shared.lock().next_generation;
        for _ in 0..100 {
            record(Path::new("/abs/f.json"), b"superseded");
            record(Path::new("/abs/g.json"), b"other superseded");
        }
        let newest = [0xEF, 0xBB, 0xBF, b'\r', b'\n', 0xFF];
        record(Path::new("/abs/f.json"), &newest);
        record(Path::new("/abs/g.json"), b"other newest");
        {
            let state = shared.lock();
            assert_eq!(state.active, Some(1), "an active snapshot is never replaced");
            assert_eq!(state.pending.len(), 2);
            assert_eq!(state.ready.iter().map(String::as_str).collect::<Vec<_>>(),
                ["/abs/f.json", "/abs/g.json"]);
            assert_eq!(state.pending["/abs/f.json"].bytes, newest);
            assert_eq!(state.pending["/abs/g.json"].bytes, b"other newest");
            assert_eq!(state.pending["/abs/f.json"].first_generation, 2);
            assert_eq!(state.pending["/abs/g.json"].first_generation, 3);
            assert!(!state.settled_through(target));
        }
        // Verify the actual database lock independently of the admission gate.
        let mut probe = open(file).unwrap();
        probe.busy_timeout(Duration::ZERO).unwrap();
        let error = try_record(&mut probe, "probe", "/abs/probe.json", b"locked")
            .expect_err("the separate writer must hold SQLite's write lock");
        assert_eq!(error.sqlite_error_code(), Some(rusqlite::ErrorCode::DatabaseBusy));
        drop(probe);
        // Repeated drains cannot report completion before the admitted write
        // settles, and do not allocate queued barrier jobs.
        for _ in 0..100 {
            assert!(!flush(Duration::ZERO));
        }
        holder.execute_batch("COMMIT").unwrap();
        drop(holder);
        release.send(()).unwrap();
        close_for_test();
        assert_eq!(rows_for(file, "/abs/f.json")[0].0, newest);
        assert_eq!(rows_for(file, "/abs/g.json")[0].0, b"other newest");
    });
}

#[test]
fn a_coalesced_successor_owns_earlier_generations_until_it_settles() {
    let mut state = State {
        pending: HashMap::from([("/abs/a.json".into(), Pending {
            bytes: b"later successor".to_vec(),
            first_generation: 2,
        })]),
        ready: VecDeque::from(["/abs/a.json".into()]),
        active: None,
        next_generation: 100,
        closing: false,
    };
    let earlier_barrier = 2;
    assert!(!state.settled_through(earlier_barrier));
    let path = state.ready.pop_front().unwrap();
    state.active = Some(state.pending.remove(&path).unwrap().first_generation);
    assert!(!state.settled_through(earlier_barrier), "dequeue is not settlement");
    state.active = None;
    assert!(state.settled_through(earlier_barrier));
    // A barrier does not acquire responsibility for newly admitted paths.
    state.active = Some(101);
    assert!(state.settled_through(earlier_barrier));
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
    assert!(flush(Duration::from_secs(10)));
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
    assert!(flush(Duration::from_secs(10)));
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
        assert!(flush(Duration::from_secs(10)));
        assert_eq!(user_version(file), 2);
    });
}

#[test]
#[serial(backup_store)]
fn a_format_1_store_is_refused_unchanged_and_records_nothing() {
    let store = temp_store();
    {
        let conn = Connection::open(&store.file).unwrap();
        conn.execute_batch(
            "CREATE TABLE backups (id INTEGER PRIMARY KEY, path TEXT NOT NULL, content BLOB NOT NULL, \
             content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, written_at_utc TEXT NOT NULL); \
             CREATE INDEX idx_backups_path_id ON backups (path, id);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc) VALUES (?1, ?2, ?3, 3, 'x')",
            rusqlite::params!["/abs/g.json", b"old".to_vec(), sha256_hex(b"old")],
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
    }
    let before = std::fs::read(&store.file).unwrap();
    let error = open(&store.file).err().expect("format 1 is unsupported");
    assert!(error.contains("unsupported backup format version 1"), "{error}");
    assert!(error.contains("left untouched"), "{error}");
    assert!(error.contains(store.file.to_str().unwrap()), "{error}");
    init(store.file.clone());
    record(Path::new("/abs/g.json"), b"new");
    close_for_test();
    assert_eq!(std::fs::read(&store.file).unwrap(), before);
    let rows = rows_for(&store.file, "/abs/g.json");
    assert_eq!(rows, vec![(b"old".to_vec(), sha256_hex(b"old"), 3, "x".to_string())]);
    assert_eq!(user_version(&store.file), 1);
    let conn = Connection::open(&store.file).unwrap();
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(backups)").unwrap()
        .query_map([], |r| r.get(1)).unwrap().map(|r| r.unwrap()).collect();
    assert_eq!(columns, ["id", "path", "content", "content_sha256", "byte_size", "written_at_utc"]);
    assert!(!store.file.with_extension("sqlite3-wal").exists());
    assert!(!store.file.with_extension("sqlite3-shm").exists());
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
        assert!(flush(Duration::from_secs(10)));
        let fixture = Connection::open(file).unwrap();
        fixture.execute_batch("DROP TABLE backups").unwrap();
        let primary = file.with_file_name("authored.json");
        let path = primary.to_str().unwrap();
        crate::write_atomic(path, "first authored version").unwrap();
        assert!(flush(Duration::from_secs(10)));
        assert_eq!(std::fs::read_to_string(&primary).unwrap(), "first authored version");
        fixture.execute_batch(SCHEMA).unwrap();
        crate::write_atomic(path, "later authored version").unwrap();
        assert_eq!(rows_for(file, path)[0].0, b"later authored version");
    });
}
