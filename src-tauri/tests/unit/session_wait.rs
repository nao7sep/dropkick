use super::{wait_for_settlement, Message, Outcome};
use std::cell::Cell;
use std::time::{Duration, Instant};

#[test]
fn settled_or_expired_wait_does_not_touch_the_queue() {
    let now = Instant::now();
    for (pending, deadline, expected) in [
        (false, now + Duration::from_secs(4), Outcome::Settled),
        (true, now, Outcome::TimedOut),
    ] {
        assert_eq!(
            wait_for_settlement(
                deadline,
                || pending,
                || now,
                |_| panic!("must not wait"),
                || panic!("must not dispatch")
            ),
            expected
        );
    }
}

#[test]
fn continuous_messages_cannot_starve_settlement() {
    let now = Instant::now();
    let count = Cell::new(0);
    let outcome = wait_for_settlement(
        now + Duration::from_secs(4),
        || count.get() < 3,
        || now,
        |_| {},
        || {
            count.set(count.get() + 1);
            assert!(count.get() <= 3, "dispatched after settlement");
            Message::Dispatched
        },
    );
    assert_eq!(outcome, Outcome::Settled);
    assert_eq!(count.get(), 3);
}

#[test]
fn continuous_messages_cannot_starve_deadline() {
    let start = Instant::now();
    let elapsed = Cell::new(Duration::ZERO);
    let outcome = wait_for_settlement(
        start + Duration::from_secs(4),
        || true,
        || start + elapsed.get(),
        |_| {},
        || {
            elapsed.set(elapsed.get() + Duration::from_secs(1));
            assert!(
                elapsed.get() <= Duration::from_secs(4),
                "dispatched past deadline"
            );
            Message::Dispatched
        },
    );
    assert_eq!(outcome, Outcome::TimedOut);
    assert_eq!(elapsed.get(), Duration::from_secs(4));
}

#[test]
fn empty_queue_polls_with_only_the_remaining_budget() {
    let start = Instant::now();
    let elapsed = Cell::new(Duration::ZERO);
    let mut waits = Vec::new();
    let outcome = wait_for_settlement(
        start + Duration::from_millis(125),
        || true,
        || start + elapsed.get(),
        |duration| {
            waits.push(duration.as_millis());
            elapsed.set(elapsed.get() + duration);
        },
        || Message::Empty,
    );
    assert_eq!(outcome, Outcome::TimedOut);
    assert_eq!(waits, [50, 50, 25]);
}

#[test]
fn settlement_during_wait_stops_before_dispatch() {
    let now = Instant::now();
    let pending = Cell::new(true);
    assert_eq!(
        wait_for_settlement(
            now + Duration::from_secs(4),
            || pending.get(),
            || now,
            |_| pending.set(false),
            || panic!("must not dispatch after settlement")
        ),
        Outcome::Settled
    );
}

#[test]
fn quit_message_ends_the_wait_without_dispatching_another_message() {
    let now = Instant::now();
    let mut calls = 0;
    assert_eq!(
        wait_for_settlement(
            now + Duration::from_secs(4),
            || true,
            || now,
            |_| {},
            || {
                calls += 1;
                assert_eq!(calls, 1);
                Message::Quit
            }
        ),
        Outcome::Quit
    );
}
