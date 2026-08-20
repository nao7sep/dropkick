// Integration tests for the logging module's pure helpers: the timestamp
// grammar the log filenames and envelopes use, and the redactor.
//
// The Logger's own internals are tested in-file — see the comment on that
// module for why they cannot be reached through a public seam.

use dropkick_lib::logging::{
    default_denied, filename_stamp, iso_millis, redact_in_place, session_filename,
};
use serde_json::json;

#[test]
fn iso_epoch() {
    assert_eq!(iso_millis(0), "1970-01-01T00:00:00.000Z");
}

#[test]
fn iso_one_second() {
    assert_eq!(iso_millis(1_000), "1970-01-01T00:00:01.000Z");
}

#[test]
fn iso_end_of_first_day() {
    assert_eq!(iso_millis(86_399_000), "1970-01-01T23:59:59.000Z");
}

#[test]
fn iso_rolls_to_second_day() {
    assert_eq!(iso_millis(86_400_000), "1970-01-02T00:00:00.000Z");
}

#[test]
fn iso_known_vector() {
    // Unix 1_700_000_000 = 2023-11-14T22:13:20Z.
    assert_eq!(iso_millis(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
}

#[test]
fn iso_preserves_milliseconds() {
    assert_eq!(iso_millis(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
}

#[test]
fn iso_handles_leap_day() {
    // Unix 951_782_400 = 2000-02-29T00:00:00Z (2000 is a leap year).
    assert_eq!(iso_millis(951_782_400_000), "2000-02-29T00:00:00.000Z");
}

#[test]
fn filename_stamp_matches_known_vector() {
    assert_eq!(filename_stamp(1_700_000_000_123), "20231114-221320-123-utc");
}

#[test]
fn session_filename_is_the_plain_utc_stamp_with_milliseconds() {
    let filename = session_filename();
    // Strictly yyyymmdd-hhmmss-fff-utc.log — no pid or id suffix.
    assert!(
        filename.ends_with("-utc.log") && !filename.contains("-p"),
        "filename {filename} must be the plain yyyymmdd-hhmmss-fff-utc.log form"
    );
    let stamp = filename.strip_suffix(".log").unwrap();
    let parts: Vec<&str> = stamp.split('-').collect();
    assert_eq!(
        parts.len(),
        4,
        "stamp {stamp} must split on '-' into 4 parts: yyyymmdd, hhmmss, fff, utc"
    );
    assert_eq!(parts[3], "utc");
    assert_eq!(parts[2].len(), 3, "millisecond part must be zero-padded to 3 digits");
}

#[test]
fn redact_matches_exact_key_case_insensitively() {
    let denied = default_denied();
    let mut value = json!({
        "token": "abc",
        "tokenCount": 5,
        "broken": true,
        "nested": { "PASSWORD": "x", "ok": 1 },
        "list": [{ "secret": "y" }, { "fine": "z" }],
    });
    redact_in_place(&mut value, &denied);
    assert_eq!(
        value,
        json!({
            "token": "[redacted]",
            "tokenCount": 5,
            "broken": true,
            "nested": { "PASSWORD": "[redacted]", "ok": 1 },
            "list": [{ "secret": "[redacted]" }, { "fine": "z" }],
        })
    );
}

#[test]
fn redact_replaces_whole_object_value() {
    let denied = default_denied();
    let mut value = json!({ "authorization": { "scheme": "Bearer", "creds": "xyz" } });
    redact_in_place(&mut value, &denied);
    assert_eq!(value, json!({ "authorization": "[redacted]" }));
}

#[test]
fn redact_never_touches_message_prose() {
    let denied = default_denied();
    let mut value = json!({ "message": "token=abc password=def", "level": "info" });
    redact_in_place(&mut value, &denied);
    assert_eq!(value["message"], json!("token=abc password=def"));
}
