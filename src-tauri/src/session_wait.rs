//! Windows shutdown wait policy, separate from Win32 queue I/O so continuous
//! traffic, settlement and deadline interleavings can be verified on any host.
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Message {
    Empty,
    Dispatched,
    Quit,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    Settled,
    TimedOut,
    Quit,
}

pub(super) fn wait_for_settlement(
    deadline: Instant,
    pending: impl Fn() -> bool,
    now: impl Fn() -> Instant,
    mut wait: impl FnMut(Duration),
    mut dispatch: impl FnMut() -> Message,
) -> Outcome {
    loop {
        if !pending() {
            return Outcome::Settled;
        }
        let current = now();
        if current >= deadline {
            return Outcome::TimedOut;
        }
        wait((deadline - current).min(Duration::from_millis(50)));
        loop {
            // A busy queue must not postpone either check until it becomes empty.
            if !pending() {
                return Outcome::Settled;
            }
            if now() >= deadline {
                return Outcome::TimedOut;
            }
            match dispatch() {
                Message::Empty => break,
                Message::Dispatched => {}
                Message::Quit => return Outcome::Quit,
            }
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/session_wait.rs"]
mod tests;
