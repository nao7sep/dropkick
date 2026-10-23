//! Runs only a named test in an owned subprocess, with disposable app storage
//! and a parent deadline independent of the child's runtime or event loop.
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if !matches!(self.0.try_wait(), Ok(Some(_))) {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

pub fn run(name: &str, environment: &[(&str, &str)], bound: Duration) -> (ExitStatus, String) {
    let directory = tempfile::tempdir().unwrap();
    let output_path = directory.path().join("output.txt");
    let output = std::fs::File::create(&output_path).unwrap();
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", name, "--nocapture"])
        .env("DROPKICK_DATA_DIR", directory.path().join("app"))
        .envs(environment.iter().copied())
        .stdout(Stdio::from(output.try_clone().unwrap()))
        .stderr(Stdio::from(output));
    let mut child = OwnedChild(command.spawn().unwrap());
    let deadline = Instant::now() + bound;
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            return (status, std::fs::read_to_string(output_path).unwrap());
        }
        assert!(Instant::now() < deadline, "owned test subprocess exceeded its deadline: {name}");
        std::thread::sleep(Duration::from_millis(10));
    }
}
