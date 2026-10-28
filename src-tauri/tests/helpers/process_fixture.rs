//! Runs only a named test in an owned subprocess, with disposable app storage,
//! and waits for it to exit.
use std::process::{Command, ExitStatus, Stdio};

pub fn run(name: &str, environment: &[(&str, &str)]) -> (ExitStatus, String) {
    let directory = tempfile::tempdir().unwrap();
    let output_path = directory.path().join("output.txt");
    let output = std::fs::File::create(&output_path).unwrap();
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", name, "--nocapture"])
        .env("DROPKICK_DATA_DIR", directory.path().join("app"))
        .envs(environment.iter().copied())
        .stdout(Stdio::from(output.try_clone().unwrap()))
        .stderr(Stdio::from(output))
        .status()
        .unwrap();
    (status, std::fs::read_to_string(output_path).unwrap())
}
