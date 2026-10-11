// These tests use only a disposable thread's Win32 queue; they never request
// logout or send session-end messages to an application window.
mod queue_tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Duration;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn PostThreadMessageW(thread: u32, message: u32, wparam: usize, lparam: isize) -> i32;
    }

    const TEST_MESSAGE: u32 = 0x8001;

    fn seed_queue() {
        // Peek creates this disposable thread's queue before its first post.
        unsafe {
            let mut msg: Msg = std::mem::zeroed();
            PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, 0);
            assert_ne!(
                PostThreadMessageW(GetCurrentThreadId(), TEST_MESSAGE, 0, 0),
                0
            );
        }
    }

    #[test]
    fn native_busy_queue_observes_settlement() {
        std::thread::spawn(|| {
            seed_queue();
            let count = Cell::new(0);
            let outcome = wait_for_settlement(
                Instant::now() + Duration::from_secs(4),
                || count.get() < 3,
                Instant::now,
                wait_for_input,
                || {
                    assert_eq!(dispatch_one(), Message::Dispatched);
                    count.set(count.get() + 1);
                    assert!(count.get() <= 3);
                    seed_queue();
                    Message::Dispatched
                },
            );
            assert_eq!(outcome, Outcome::Settled);
            assert_eq!(count.get(), 3);
            assert_eq!(
                dispatch_one(),
                Message::Dispatched,
                "leave queued traffic alone after settlement"
            );
        })
        .join()
        .unwrap();
    }

    #[test]
    fn native_busy_queue_observes_deadline() {
        std::thread::spawn(|| {
            seed_queue();
            let start = Instant::now();
            let elapsed = Cell::new(Duration::ZERO);
            let outcome = wait_for_settlement(
                start + Duration::from_secs(4),
                || true,
                || start + elapsed.get(),
                wait_for_input,
                || {
                    assert_eq!(dispatch_one(), Message::Dispatched);
                    elapsed.set(elapsed.get() + Duration::from_secs(1));
                    assert!(elapsed.get() <= Duration::from_secs(4));
                    seed_queue();
                    Message::Dispatched
                },
            );
            assert_eq!(outcome, Outcome::TimedOut);
            assert_eq!(
                dispatch_one(),
                Message::Dispatched,
                "leave queued traffic alone after deadline"
            );
        })
        .join()
        .unwrap();
    }

    #[test]
    fn native_quit_is_preserved_for_the_outer_event_loop() {
        std::thread::spawn(|| unsafe {
            PostQuitMessage(17);
            assert_eq!(
                wait_for_settlement(
                    Instant::now() + Duration::from_secs(4),
                    || true,
                    Instant::now,
                    wait_for_input,
                    dispatch_one,
                ),
                Outcome::Quit
            );
            let mut msg: Msg = std::mem::zeroed();
            assert_ne!(
                PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE),
                0
            );
            assert_eq!(msg.message, WM_QUIT);
            assert_eq!(msg.wparam, 17);
        })
        .join()
        .unwrap();
    }
}
