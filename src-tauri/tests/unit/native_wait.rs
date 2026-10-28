use std::sync::mpsc;
use std::time::Duration;

struct HeldThread { release: Option<mpsc::Sender<()>>, thread: Option<std::thread::JoinHandle<()>> }
impl Drop for HeldThread {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() { let _ = release.send(()); }
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
    }
}

#[test]
fn the_exit_deadline_covers_a_stalled_optional_tail() {
    let (release, held) = mpsc::channel();
    let (expired, expiry) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        crate::native_wait::exit_tail_until(
            std::time::Instant::now() + Duration::from_millis(20),
            move || {
                let _ = expired.send(());
            },
            |_| {
                let _ = held.recv();
            },
        );
    });
    let _fixture = HeldThread { release: Some(release), thread: Some(thread) };
    expiry.recv().unwrap();
}

// Run against a process-local runtime with exactly two async workers. Admission
// is observed inside both blocking bodies, not merely when futures are queued.
#[test]
fn stalled_commands_do_not_hold_up_another_and_settle_with_their_real_result() {
    const NAME: &str = "native_wait::tests::stalled_commands_do_not_hold_up_another_and_settle_with_their_real_result";
    let Ok(mode) = std::env::var("DROPKICK_DISPATCH_FIXTURE") else {
        let (status, output) = crate::process_fixture::run(NAME,
            &[("DROPKICK_DISPATCH_FIXTURE", "pool"), ("TOKIO_WORKER_THREADS", "2")], Duration::from_secs(10));
        assert!(status.success(), "{output}");
        let (status, output) = crate::process_fixture::run(NAME,
            &[("DROPKICK_DISPATCH_FIXTURE", "inline"), ("TOKIO_WORKER_THREADS", "2")], Duration::from_secs(10));
        assert!(!status.success(), "inline blocking unexpectedly passed");
        assert!(output.contains("runtime responsiveness failed"), "mutant failed for another reason: {output}");
        return;
    };
    let runtime = tauri::async_runtime::TokioRuntime::new().unwrap();
    assert_eq!(runtime.metrics().num_workers(), 2);
    tauri::async_runtime::set(runtime.handle().clone());
    let (admitted, started) = mpsc::channel();
    let mut releases = Vec::new();
    let mut jobs = Vec::new();
    for index in 0..2 {
        let (release, held) = mpsc::channel();
        releases.push(release);
        let admitted = admitted.clone();
        let inline = mode == "inline";
        jobs.push(tauri::async_runtime::spawn(async move {
            let work = move || {
                let _ = admitted.send(());
                held.recv_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
                Ok(index)
            };
            if inline { work() } else { crate::native_wait::settle(work).await }
        }));
    }
    for _ in 0..2 { started.recv_timeout(Duration::from_secs(2)).unwrap(); }
    let (answered, answer) = mpsc::channel();
    let quick = tauri::async_runtime::spawn(async move {
        let _ = answered.send(crate::native_wait::settle(|| Ok("quick")).await);
    });
    let responsive = answer.recv_timeout(Duration::from_secs(1));
    // Always release the blocking bodies before asserting, including the mutant.
    for release in releases { let _ = release.send(()); }
    let mut settled: Vec<_> = jobs.into_iter()
        .map(|job| runtime.block_on(job).unwrap().unwrap()).collect();
    runtime.block_on(quick).unwrap();
    settled.sort_unstable();
    assert_eq!(settled, vec![0, 1]);
    assert_eq!(responsive.unwrap_or_else(|_| panic!("runtime responsiveness failed")), Ok("quick"));
}
