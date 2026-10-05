// The Records window's reads of records.sqlite3: paging, filters, the launch
// list and one record whole, against a database of the logger's own shape.

use dropkick_lib::logging::SCHEMA;
use dropkick_lib::records::{
    open, read_detail, read_page, read_sources, LevelFilter, RecordCursor, RecordsQuery, PAGE_SIZE,
};
use rusqlite::Connection;

struct Fixture {
    _dir: tempfile::TempDir,
    path: std::path::PathBuf,
    // The writer, kept open as the logger keeps its own while the app runs.
    writer: Connection,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("records.sqlite3");
    let writer = Connection::open(&path).expect("open writer");
    writer
        .pragma_update(None, "journal_mode", "WAL")
        .expect("wal");
    writer.execute_batch(SCHEMA).expect("schema");
    // Stamped as the logger stamps the database it creates.
    writer
        .pragma_update(None, "user_version", 1)
        .expect("format version");
    Fixture {
        _dir: dir,
        path,
        writer,
    }
}

impl Fixture {
    fn insert(
        &self,
        time: &str,
        session: &str,
        level: &str,
        message: &str,
        task_id: Option<&str>,
        fields: &str,
    ) -> i64 {
        self.writer
            .execute(
                "INSERT INTO logs (time, session, level, message, task_id, fields) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![time, session, level, message, task_id, fields],
            )
            .expect("insert");
        self.writer.last_insert_rowid()
    }

    fn reader(&self) -> Connection {
        open(&self.path).expect("open reader")
    }
}

const S1: &str = "2026-10-01T08:00:00.000Z";
const S2: &str = "2026-10-02T08:00:00.000Z";

fn messages(page: &dropkick_lib::records::RecordsPage) -> Vec<&str> {
    page.records.iter().map(|r| r.message.as_str()).collect()
}

#[test]
fn a_page_lists_the_newest_records_first() {
    let f = fixture();
    f.insert("2026-10-02T08:00:01.000Z", S2, "info", "first", None, "{}");
    f.insert("2026-10-02T08:00:03.000Z", S2, "info", "third", None, "{}");
    f.insert("2026-10-02T08:00:02.000Z", S2, "info", "second", None, "{}");

    let page = read_page(&f.reader(), &RecordsQuery::default()).expect("page");

    assert_eq!(messages(&page), ["third", "second", "first"]);
    assert!(!page.more);
}

#[test]
fn records_at_the_same_instant_order_by_id_and_page_without_loss() {
    let f = fixture();
    let time = "2026-10-02T08:00:00.000Z";
    for index in 0..(PAGE_SIZE + 5) {
        f.insert(time, S2, "info", &format!("m{index}"), None, "{}");
    }
    let reader = f.reader();

    let first = read_page(&reader, &RecordsQuery::default()).expect("first page");
    assert_eq!(first.records.len(), PAGE_SIZE);
    assert!(first.more);
    assert_eq!(first.records[0].message, format!("m{}", PAGE_SIZE + 4));

    let last = first.records.last().expect("a last record");
    let next = read_page(
        &reader,
        &RecordsQuery {
            after: Some(RecordCursor {
                time: last.time.clone(),
                id: last.id,
            }),
            ..RecordsQuery::default()
        },
    )
    .expect("next page");
    assert_eq!(messages(&next), ["m4", "m3", "m2", "m1", "m0"]);
    assert!(!next.more);
}

#[test]
fn a_page_of_exactly_the_page_size_has_no_more() {
    let f = fixture();
    for index in 0..PAGE_SIZE {
        f.insert(
            &format!("2026-10-02T08:00:00.{index:03}Z"),
            S2,
            "info",
            "m",
            None,
            "{}",
        );
    }
    let page = read_page(&f.reader(), &RecordsQuery::default()).expect("page");
    assert_eq!(page.records.len(), PAGE_SIZE);
    assert!(!page.more);
}

#[test]
fn needs_attention_keeps_warnings_and_errors() {
    let f = fixture();
    f.insert("2026-10-02T08:00:01.000Z", S2, "debug", "d", None, "{}");
    f.insert("2026-10-02T08:00:02.000Z", S2, "info", "i", None, "{}");
    f.insert("2026-10-02T08:00:03.000Z", S2, "warn", "w", None, "{}");
    f.insert("2026-10-02T08:00:04.000Z", S2, "error", "e", None, "{}");
    let reader = f.reader();
    let with = |level| {
        read_page(
            &reader,
            &RecordsQuery {
                level: Some(level),
                ..RecordsQuery::default()
            },
        )
        .expect("page")
    };

    assert_eq!(messages(&with(LevelFilter::Attention)), ["e", "w"]);
    assert_eq!(messages(&with(LevelFilter::Error)), ["e"]);
    assert_eq!(messages(&with(LevelFilter::Warn)), ["w"]);
    assert_eq!(messages(&with(LevelFilter::Info)), ["i"]);
    assert_eq!(messages(&with(LevelFilter::Debug)), ["d"]);
}

#[test]
fn a_launch_keeps_only_its_own_records() {
    let f = fixture();
    f.insert(
        "2026-10-01T08:00:01.000Z",
        S1,
        "info",
        "earlier launch",
        None,
        "{}",
    );
    f.insert(
        "2026-10-02T08:00:01.000Z",
        S2,
        "info",
        "this launch",
        None,
        "{}",
    );

    let page = read_page(
        &f.reader(),
        &RecordsQuery {
            session: Some(S1.to_string()),
            ..RecordsQuery::default()
        },
    )
    .expect("page");

    assert_eq!(messages(&page), ["earlier launch"]);
}

#[test]
fn search_matches_the_message_the_task_and_every_field_literally() {
    let f = fixture();
    f.insert(
        "2026-10-02T08:00:01.000Z",
        S2,
        "info",
        "task saved",
        None,
        "{}",
    );
    f.insert(
        "2026-10-02T08:00:02.000Z",
        S2,
        "info",
        "other",
        Some("task-7"),
        "{}",
    );
    f.insert(
        "2026-10-02T08:00:03.000Z",
        S2,
        "info",
        "write",
        None,
        r#"{"path":"/lists/100%_done.json"}"#,
    );
    f.insert(
        "2026-10-02T08:00:04.000Z",
        S2,
        "info",
        "write",
        None,
        r#"{"path":"/lists/100xxdone.json"}"#,
    );
    let reader = f.reader();
    let search = |text: &str| {
        read_page(
            &reader,
            &RecordsQuery {
                search: text.to_string(),
                ..RecordsQuery::default()
            },
        )
        .expect("page")
    };

    assert_eq!(messages(&search("SAVED")), ["task saved"]);
    assert_eq!(
        search("task-7").records[0].task_id.as_deref(),
        Some("task-7")
    );
    // `%` and `_` match themselves, not any text.
    assert_eq!(search("100%_done").records.len(), 1);
    // Blank search filters nothing.
    assert_eq!(search("   ").records.len(), 4);
}

#[test]
fn the_launches_are_listed_newest_first_with_this_one_named() {
    let f = fixture();
    f.insert("2026-10-01T08:00:01.000Z", S1, "info", "a", None, "{}");
    f.insert("2026-10-02T08:00:01.000Z", S2, "info", "b", None, "{}");
    f.insert("2026-10-02T08:00:02.000Z", S2, "info", "c", None, "{}");

    let sources = read_sources(&f.reader(), Some(S2.to_string())).expect("sources");

    assert_eq!(sources.sessions, [S2, S1]);
    assert_eq!(sources.current_session.as_deref(), Some(S2));
}

#[test]
fn a_record_is_read_whole_and_a_missing_one_is_none() {
    let f = fixture();
    let id = f.insert(
        "2026-10-02T08:00:01.000Z",
        S2,
        "error",
        "command error",
        Some("task-1"),
        r#"{"command":"hash_file","error":{"message":"denied"}}"#,
    );
    let reader = f.reader();

    let detail = read_detail(&reader, id).expect("detail").expect("a record");
    assert_eq!(detail.message, "command error");
    assert_eq!(detail.level, "error");
    assert_eq!(detail.session, S2);
    assert_eq!(detail.task_id.as_deref(), Some("task-1"));
    assert_eq!(
        detail.fields,
        r#"{"command":"hash_file","error":{"message":"denied"}}"#
    );

    assert!(read_detail(&reader, id + 1).expect("detail").is_none());
}

#[test]
fn the_reader_never_writes() {
    let f = fixture();
    let reader = f.reader();
    assert!(reader
        .execute("INSERT INTO logs (time, session, level, message, fields) VALUES ('t', 's', 'info', 'm', '{}')", [])
        .is_err());
}

#[test]
fn a_missing_database_cannot_be_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("records.sqlite3");
    assert!(open(&path).is_err());
    assert!(!path.exists(), "a read creates no database");
}

#[test]
fn the_query_arrives_as_the_window_sends_it() {
    let query: RecordsQuery = serde_json::from_value(serde_json::json!({
        "session": S2,
        "level": "attention",
        "search": "x",
        "after": { "time": "2026-10-02T08:00:00.000Z", "id": 4 },
    }))
    .expect("query");
    assert_eq!(query.session.as_deref(), Some(S2));
    assert_eq!(query.level, Some(LevelFilter::Attention));
    assert_eq!(
        query.after,
        Some(RecordCursor {
            time: "2026-10-02T08:00:00.000Z".to_string(),
            id: 4
        })
    );
}

#[test]
fn a_database_without_its_format_version_is_not_read() {
    let f = fixture();
    f.writer
        .pragma_update(None, "user_version", 0)
        .expect("clear version");
    assert!(open(&f.path).is_err());
}

#[test]
fn a_newer_database_is_not_read() {
    let f = fixture();
    f.writer.pragma_update(None, "user_version", 2).expect("set version");
    let error = open(&f.path).expect_err("a newer database is refused");
    assert!(error.contains("records.sqlite3"), "{error}");
}
