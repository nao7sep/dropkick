use crate::native_wait::run_with_bound;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::time::Duration;

struct HeldThread { release: Option<mpsc::Sender<()>>, thread: Option<std::thread::JoinHandle<()>> }
impl Drop for HeldThread {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() { let _ = release.send(()); }
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
    }
}

struct HeldWork { release: mpsc::Sender<()>, finished: mpsc::Receiver<()> }
impl Drop for HeldWork {
    fn drop(&mut self) {
        let _ = self.release.send(());
        let _ = self.finished.recv_timeout(Duration::from_secs(1));
    }
}

#[test]
fn the_exit_deadline_covers_a_stalled_optional_tail() {
    let (release, held) = mpsc::channel();
    let (expired, expiry) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        crate::native_wait::exit_tail_with_bound(
            Duration::from_millis(20),
            move || {
                let _ = expired.send(());
            },
            || {
                let _ = held.recv();
            },
        );
    });
    let _fixture = HeldThread { release: Some(release), thread: Some(thread) };
    expiry.recv_timeout(Duration::from_secs(1)).unwrap();
}

#[test]
fn a_timed_out_worker_keeps_ownership_until_its_real_work_finishes() {
    let key = "native-wait-retained-claim".to_string();
    let (release, held) = mpsc::channel();
    let (admitted, started) = mpsc::channel();
    let (settled, finished) = mpsc::channel();
    let fixture = HeldWork { release, finished };
    let result = run_with_bound(key.clone(), Duration::from_millis(20), move || {
        let _ = admitted.send(());
        let result = held.recv().map_err(|e| e.to_string());
        let _ = settled.send(());
        result
    });
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(result.unwrap_err().contains("remains unknown"));
    let ran = Arc::new(AtomicBool::new(false));
    let attempted = ran.clone();
    assert!(run_with_bound(key, Duration::from_secs(1), move || {
        attempted.store(true, Ordering::SeqCst);
        Ok(())
    })
    .unwrap_err()
    .contains("remains in progress"));
    assert!(!ran.load(Ordering::SeqCst));
    assert!(run_with_bound(
        "another-native-resource".to_string(),
        Duration::from_secs(1),
        || Ok(())
    )
    .is_ok());
    fixture.release.send(()).unwrap();
    fixture.finished.recv_timeout(Duration::from_secs(1)).unwrap();
}

// More stalled commands than the runtime has workers: under the old dispatch
// (a synchronous body on an async worker) the quick command below could not
// start until one of them gave up.
#[test]
fn stalled_commands_do_not_hold_up_another_and_settle_with_their_real_result() {
    use crate::native_wait::settle;
    use tauri::async_runtime::{block_on, spawn};
    const STALLED: usize = 64;
    let (release, held) = std::sync::mpsc::channel::<()>();
    let held = Arc::new(std::sync::Mutex::new(held));
    let (admitted, started) = mpsc::channel();
    let stalled: Vec<_> = (0..STALLED)
        .map(|index| {
            let held = held.clone();
            let admitted = admitted.clone();
            spawn(settle(move || {
                let _ = admitted.send(());
                held.lock().unwrap().recv().map_err(|e| e.to_string())?;
                Ok(index)
            }))
        })
        .collect();
    started.recv_timeout(Duration::from_secs(5)).unwrap();

    let (answered, answer) = mpsc::channel();
    spawn(async move {
        let _ = answered.send(settle(|| Ok("quick")).await);
    });
    assert_eq!(answer.recv_timeout(Duration::from_secs(5)).unwrap(), Ok("quick"));

    for _ in 0..STALLED {
        release.send(()).unwrap();
    }
    let mut settled: Vec<usize> = stalled
        .into_iter()
        .map(|task| block_on(task).unwrap().unwrap())
        .collect();
    settled.sort_unstable();
    assert_eq!(settled, (0..STALLED).collect::<Vec<_>>());
}
