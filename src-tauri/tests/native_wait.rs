use dropkick_lib::native_wait::run_with_bound;
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
        dropkick_lib::native_wait::exit_tail_with_bound(
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
    assert!(dropkick_lib::native_wait::read_keyed("native-wait-retained-claim".to_string(), || Ok(())).is_err());
    assert!(run_with_bound(
        "another-native-resource".to_string(),
        Duration::from_secs(1),
        || Ok(())
    )
    .is_ok());
    fixture.release.send(()).unwrap();
    fixture.finished.recv_timeout(Duration::from_secs(1)).unwrap();
}

#[test]
fn ordinary_reads_can_overlap_for_the_same_resource() {
    let key = "shared-native-reader".to_string();
    let (release, held) = mpsc::channel();
    let (admitted, started) = mpsc::channel();
    let first_key = key.clone();
    let thread = std::thread::spawn(move || {
        dropkick_lib::native_wait::read_keyed(first_key, move || {
            let _ = admitted.send(());
            held.recv().map_err(|e| e.to_string())
        }).unwrap();
    });
    let _fixture = HeldThread { release: Some(release), thread: Some(thread) };
    started.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(dropkick_lib::native_wait::read_keyed(key.clone(), || Ok(())).is_ok());
    assert!(run_with_bound(key, Duration::from_secs(1), || Ok(())).is_err());
}
