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
// is observed inside both blocking bodies, not merely when futures are queued;
// with both workers' commands held, a quick command still settles.
#[test]
fn stalled_commands_do_not_hold_up_another_and_settle_with_their_real_result() {
    const NAME: &str = "native_wait::tests::stalled_commands_do_not_hold_up_another_and_settle_with_their_real_result";
    if std::env::var_os("DROPKICK_DISPATCH_FIXTURE").is_none() {
        let (status, output) = crate::process_fixture::run(NAME,
            &[("DROPKICK_DISPATCH_FIXTURE", "1"), ("TOKIO_WORKER_THREADS", "2")]);
        assert!(status.success(), "{output}");
        return;
    }
    let runtime = tauri::async_runtime::TokioRuntime::new().unwrap();
    assert_eq!(runtime.metrics().num_workers(), 2);
    tauri::async_runtime::set(runtime.handle().clone());
    let (admitted, started) = mpsc::channel();
    let mut releases = Vec::new();
    let mut jobs = Vec::new();
    for index in 0..2 {
        let (release, held) = mpsc::channel::<()>();
        releases.push(release);
        let admitted = admitted.clone();
        jobs.push(tauri::async_runtime::spawn(async move {
            crate::native_wait::settle(move || {
                let _ = admitted.send(());
                held.recv().map_err(|error| error.to_string())?;
                Ok(index)
            }).await
        }));
    }
    for _ in 0..2 { started.recv().unwrap(); }
    let (answered, answer) = mpsc::channel();
    let quick = tauri::async_runtime::spawn(async move {
        let _ = answered.send(crate::native_wait::settle(|| Ok("quick")).await);
    });
    assert_eq!(answer.recv().unwrap(), Ok("quick"));
    for release in releases { let _ = release.send(()); }
    let mut settled: Vec<_> = jobs.into_iter()
        .map(|job| runtime.block_on(job).unwrap().unwrap()).collect();
    runtime.block_on(quick).unwrap();
    settled.sort_unstable();
    assert_eq!(settled, vec![0, 1]);
}
