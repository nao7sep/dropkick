use super::*;

fn simultaneous_claims(root: &Path) -> Vec<Result<bool, String>> {
    let root = std::sync::Arc::new(root.to_path_buf());
    let start = std::sync::Arc::new(std::sync::Barrier::new(3));
    let hold = std::sync::Arc::new(std::sync::Barrier::new(3));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let root = root.clone();
        let start = start.clone();
        let hold = hold.clone();
        workers.push(std::thread::spawn(move || {
            start.wait();
            let claim = claim(&root);
            hold.wait();
            claim.map(|claim| matches!(claim, Claim::Primary { .. }))
        }));
    }
    start.wait();
    hold.wait();

    workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect()
}

#[test]
fn simultaneous_claims_have_exactly_one_owner() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        simultaneous_claims(dir.path())
            .into_iter()
            .map(Result::unwrap)
            .filter(|primary| *primary)
            .count(),
        1
    );
}

#[test]
fn simultaneous_claim_failures_release_every_worker() {
    let dir = tempfile::tempdir().unwrap();
    let results = simultaneous_claims(&dir.path().join("missing"));
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(Result::is_err));
}

#[test]
fn exactly_one_claim_owns_a_root_and_drop_releases_it() {
    let dir = tempfile::tempdir().unwrap();
    let first = claim(dir.path()).unwrap();
    assert!(matches!(first, Claim::Primary { .. }));
    assert!(matches!(
        claim(dir.path()).unwrap(),
        Claim::Secondary { .. }
    ));

    drop(first);
    assert!(matches!(claim(dir.path()).unwrap(), Claim::Primary { .. }));
}

#[test]
fn secondary_activation_uses_the_published_endpoint() {
    let dir = tempfile::tempdir().unwrap();
    let Claim::Primary {
        lock: _lock,
        listener,
    } = claim(dir.path()).unwrap()
    else {
        panic!("first claim must own the root");
    };
    listener.set_nonblocking(false).unwrap();
    let Claim::Secondary { endpoint_path } = claim(dir.path()).unwrap() else {
        panic!("second claim must be secondary");
    };

    let receiver = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = String::new();
        stream.read_to_string(&mut request).unwrap();
        request
    });
    notify_primary(&endpoint_path).unwrap();
    assert_eq!(receiver.join().unwrap(), "activate");
}

struct HeldStartup {
    release: std::sync::mpsc::Sender<()>,
    caller: Option<std::thread::JoinHandle<()>>,
}
impl Drop for HeldStartup {
    fn drop(&mut self) {
        let _ = self.release.send(());
        if let Some(caller) = self.caller.take() { let _ = caller.join(); }
    }
}

#[test]
fn startup_wait_is_bounded_and_a_late_claim_never_admits_a_writable_session() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let (release, held) = std::sync::mpsc::channel();
    let (finished, settled) = std::sync::mpsc::channel();
    let (done, result) = std::sync::mpsc::channel();
    let caller = std::thread::spawn(move || {
        let root = establish_with_bound(Duration::from_millis(20), move || {
            held.recv().unwrap();
            let owner = claim(&path)?;
            finished.send(owner).unwrap();
            Ok(path)
        });
        done.send(root).unwrap();
    });
    let fixture = HeldStartup { release, caller: Some(caller) };
    let root = result.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(root.0.is_err());
    fixture.release.send(()).unwrap();
    let owner = settled.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(root.0.is_err(), "late completion must not bypass failed startup");
    assert!(matches!(claim(dir.path()).unwrap(), Claim::Secondary { .. }));
    drop(owner);
    assert!(matches!(claim(dir.path()).unwrap(), Claim::Primary { .. }));
}

#[test]
fn fragmented_activation_waits_for_the_complete_frame() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let (done, result) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        // Exercise the mode normalization even on a host that inherits it.
        stream.set_nonblocking(true).unwrap();
        let _ = done.send(read_activation(&mut stream, Duration::from_secs(2)));
    });
    let mut client = TcpStream::connect(address).unwrap();
    client.write_all(b"act").unwrap();
    assert!(matches!(result.recv_timeout(Duration::from_millis(20)), Err(std::sync::mpsc::RecvTimeoutError::Timeout)));
    client.write_all(b"ivate").unwrap();
    assert!(result.recv_timeout(Duration::from_secs(3)).unwrap().unwrap());
    worker.join().unwrap();
}

#[test]
fn short_and_silent_connections_do_not_prevent_a_later_activation() {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let (done, results) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        for _ in 0..3 {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = done.send(read_activation(&mut stream, Duration::from_millis(100)).unwrap_or(false));
        }
    });
    let mut short = TcpStream::connect(address).unwrap();
    short.write_all(b"act").unwrap();
    short.shutdown(std::net::Shutdown::Write).unwrap();
    assert!(!results.recv_timeout(Duration::from_secs(2)).unwrap());
    let _silent = TcpStream::connect(address).unwrap();
    assert!(!results.recv_timeout(Duration::from_secs(2)).unwrap());
    let mut valid = TcpStream::connect(address).unwrap();
    valid.write_all(b"activate").unwrap();
    assert!(results.recv_timeout(Duration::from_secs(2)).unwrap());
    worker.join().unwrap();
}

#[test]
fn launcher_close_authentication_binds_secret_root_and_generation() {
    let identity = LauncherIdentity { port: 1, pid: 1, generation: "owned-generation".into(), secret: "fixture-secret".into(), root: PathBuf::from("/owned/root") };
    for field in [None, Some("generation"), Some("secret"), Some("root")] {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected = identity.clone();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            authenticated_close(&mut stream, &expected)
        });
        let mut request = serde_json::json!({ "generation": identity.generation, "secret": identity.secret, "root": identity.root });
        if let Some(field) = field { request[field] = "different".into(); }
        let mut client = TcpStream::connect(address).unwrap();
        writeln!(client, "{request}").unwrap();
        assert_eq!(worker.join().unwrap(), field.is_none());
    }
}

#[test]
fn a_late_close_reply_cannot_retire_the_next_close_request() {
    let close = LauncherClose::default();
    let (first, first_result) = close.begin().unwrap();
    assert!(close.begin().is_none());
    close.settle(false);
    assert!(!first_result.recv().unwrap());
    let (_, next_result) = close.begin().unwrap();
    close.retire(&first);
    assert!(close.begin().is_none());
    close.settle(true);
    assert!(next_result.recv().unwrap());
}
