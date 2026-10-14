// The decisions behind OS-started quits, apart from AppKit and Win32: the
// platform calls only supply whether a main window exists, whether the quit
// is the end of a session, and whether the window could be asked.
use super::*;

fn reset() {
    SESSION_END_PENDING.store(false, Ordering::SeqCst);
    SESSION_ENDED.store(false, Ordering::SeqCst);
}

#[test]
#[serial_test::serial(os_quit)]
fn the_first_request_asks_the_window_and_later_ones_reuse_its_bound() {
    reset();
    let mut asked = 0;
    assert_eq!(begin_with(|| { asked += 1; Ok(()) }), SessionEndStart::Started);
    assert_eq!(begin_with(|| { asked += 1; Ok(()) }), SessionEndStart::AlreadyPending);
    assert_eq!(asked, 1, "a nested request must not ask again or start another wait");
    assert!(session_ended());
}

#[test]
#[serial_test::serial(os_quit)]
fn a_window_that_cannot_be_asked_lets_the_session_go_on_at_once() {
    reset();
    assert_eq!(begin_with(|| Err("no webview".to_string())), SessionEndStart::NoWindow);
    assert!(!SESSION_END_PENDING.load(Ordering::SeqCst), "nothing is left waiting");
    // Optional exit work is still skipped: the OS is ending the session.
    assert!(session_ended());
    assert_eq!(begin_with(|| Ok(())), SessionEndStart::Started);
}

#[test]
#[serial_test::serial(os_quit)]
fn the_session_is_let_go_once_whichever_of_report_and_bound_comes_first() {
    reset();
    assert_eq!(begin_with(|| Ok(())), SessionEndStart::Started);
    assert!(take_pending("settled"), "the window's report lets the session go on");
    assert!(!take_pending("timed out"), "the bound's later timer finds it over");

    assert_eq!(begin_with(|| Ok(())), SessionEndStart::Started);
    assert!(take_pending("timed out"), "the bound lets go of a window that never reports");
    assert!(!take_pending("settled"), "a late report finds it over");
}

#[test]
fn a_quit_with_no_main_window_terminates_at_once() {
    let reply = terminate_reply(false, true, || panic!("no window to ask"));
    assert_eq!(reply, TerminateReply::Now);
}

#[test]
fn dock_quit_goes_through_the_windows_close_path() {
    let reply = terminate_reply(true, false, || panic!("not the end of a session"));
    assert_eq!(reply, TerminateReply::Cancel);
}

#[test]
fn the_end_of_a_session_waits_for_the_window_and_never_cancels() {
    assert_eq!(
        terminate_reply(true, true, || SessionEndStart::Started),
        TerminateReply::Later { start_bound: true },
    );
    assert_eq!(
        terminate_reply(true, true, || SessionEndStart::AlreadyPending),
        TerminateReply::Later { start_bound: false },
        "a repeated request keeps the first bound",
    );
    assert_eq!(
        terminate_reply(true, true, || SessionEndStart::NoWindow),
        TerminateReply::Now,
    );
}

// The Win32 queue adapter (tests/unit/windows_session_wait.rs) drives the
// thread's real message queue, so it compiles and runs only on Windows. These
// stand in for it elsewhere so the suite reports it skipped, not absent.
#[cfg(not(windows))]
mod windows_queue {
    #[test]
    #[ignore = "Windows only: drives the Win32 message queue"]
    fn native_busy_queue_observes_settlement() {}

    #[test]
    #[ignore = "Windows only: drives the Win32 message queue"]
    fn native_busy_queue_observes_deadline() {}

    #[test]
    #[ignore = "Windows only: drives the Win32 message queue"]
    fn native_quit_is_preserved_for_the_outer_event_loop() {}
}
