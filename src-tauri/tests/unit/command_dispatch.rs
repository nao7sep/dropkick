// A plain synchronous #[tauri::command] runs inline on the thread that drives
// the webview, so a command that touches the filesystem would freeze the window
// for the length of the call, and `#[tauri::command(async)]` only moves it onto
// an async-runtime worker, which stalled storage can exhaust. Every filesystem
// command is therefore an `async fn` that hands its disk work to
// native_wait::settle. This reads lib.rs's syntax tree and derives which
// commands reach the disk from what their bodies call.
use syn::visit::Visit;

struct Command {
    name: String,
    is_async: bool,
    attribute_async: bool,
    touches_disk: bool,
    settles: bool,
}

#[derive(Default)]
struct Calls(Vec<String>);

impl<'ast> Visit<'ast> for Calls {
    fn visit_path(&mut self, path: &'ast syn::Path) {
        self.0.push(path.segments.iter().map(|segment| segment.ident.to_string()).collect::<Vec<_>>().join("::"));
        syn::visit::visit_path(self, path);
    }
}

// Direct filesystem use, or the crate's helpers that reach it.
fn reaches_disk(path: &str) -> bool {
    path.starts_with("std::fs")
        || path == "write_atomic"
        || path == "write_atomic_unrecorded"
        || path == "paths::data_root"
        || path == "records_window::open"
}

fn commands(source: &str) -> Vec<Command> {
    let file = syn::parse_file(source).expect("lib.rs parses");
    file.items
        .iter()
        .filter_map(|item| match item {
            syn::Item::Fn(function) => Some(function),
            _ => None,
        })
        .filter_map(|function| {
            let attribute = function.attrs.iter().find(|attr| {
                let segments: Vec<_> = attr.path().segments.iter().map(|s| s.ident.to_string()).collect();
                segments == ["tauri", "command"]
            })?;
            let attribute_async = match &attribute.meta {
                syn::Meta::List(list) => list.tokens.to_string().contains("async"),
                _ => false,
            };
            let mut calls = Calls::default();
            calls.visit_block(&function.block);
            Some(Command {
                name: function.sig.ident.to_string(),
                is_async: function.sig.asyncness.is_some(),
                attribute_async,
                touches_disk: calls.0.iter().any(|path| reaches_disk(path)),
                settles: calls.0.iter().any(|path| path == "native_wait::settle"),
            })
        })
        .collect()
}

fn unsettled(found: &[Command]) -> Vec<String> {
    found
        .iter()
        .filter(|command| command.touches_disk && !(command.is_async && command.settles))
        .map(|command| command.name.clone())
        .collect()
}

#[test]
fn detects_a_command_that_reaches_the_disk_without_settle() {
    let planted = commands(
        "#[tauri::command] fn inline_save() { write_atomic_unrecorded(path, contents); }
         #[tauri::command(async)] fn worker_save() { write_atomic(path, contents); }
         #[tauri::command(async)] fn records_open() { records_window::open(app, context); }
         #[tauri::command] fn read_dir() { std::fs::read_dir(path); }
         #[tauri::command] async fn settled_save() { native_wait::settle(move || write_atomic(path, contents)).await }",
    );
    assert_eq!(unsettled(&planted), ["inline_save", "worker_save", "records_open", "read_dir"]);
}

#[test]
fn runs_every_shipped_filesystem_command_through_settle() {
    let shipped = commands(include_str!("../../src/lib.rs"));
    // Parsing that found no commands would make the check below vacuous.
    assert!(shipped.iter().any(|command| command.name == "write_text_file_atomic" && command.touches_disk));
    assert_eq!(unsettled(&shipped), Vec::<String>::new());
}

#[test]
fn writes_log_records_off_the_ui_thread() {
    // The frontend sends one entry at a time and waits for it, so the pool
    // cannot reorder them.
    let shipped = commands(include_str!("../../src/lib.rs"));
    let log_event = shipped.iter().find(|command| command.name == "log_event").expect("log_event is a command");
    assert!(log_event.is_async || log_event.attribute_async);
}

// Paths every function in `source` named `name` calls.
fn calls_of(source: &str, name: &str) -> Vec<String> {
    let file = syn::parse_file(source).expect("lib.rs parses");
    let function = file
        .items
        .iter()
        .find_map(|item| match item {
            syn::Item::Fn(function) if function.sig.ident == name => Some(function),
            _ => None,
        })
        .unwrap_or_else(|| panic!("{name} is defined"));
    let mut calls = Calls::default();
    calls.visit_block(&function.block);
    calls.0
}

// Reading the Records store writes no record of its own success: a record
// written on every read would be stored, signalled to the open Records window,
// read again and recorded again, without end. Only a failure is recorded.
#[test]
fn reads_records_without_recording_its_own_success() {
    let source = include_str!("../../src/lib.rs");
    let success_records = ["log_cmd_start", "log_cmd_ok", "logging::info", "logging::debug", "logging::warn"];
    let reader = calls_of(source, "read_records");
    assert!(reader.iter().any(|path| path == "log_cmd_err"), "a failed read is recorded");
    assert!(reader.iter().any(|path| path == "native_wait::settle"), "the read runs off the webview's thread");
    assert!(!reader.iter().any(|path| success_records.contains(&path.as_str())));
    for command in ["read_records_page", "read_record_sources", "read_record_detail"] {
        let calls = calls_of(source, command);
        assert!(calls.iter().any(|path| path == "read_records"), "{command} reads through read_records");
        assert!(!calls.iter().any(|path| success_records.contains(&path.as_str()) || path == "logging::error"), "{command} records nothing itself");
    }
}

#[test]
fn a_success_record_in_a_reader_is_seen() {
    let planted = "fn read_records() { native_wait::settle(|| ()); log_cmd_err(); logging::info(\"read\"); }";
    assert!(calls_of(planted, "read_records").iter().any(|path| path == "logging::info"));
}
