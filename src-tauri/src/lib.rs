use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDto {
    id: String,
    content: String,
    actionability: String,
    created_at_utc: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDto {
    id: String,
    title: String,
    description: String,
    status: String,
    priority: String,
    due_date: Option<String>,
    created_at_utc: String,
    updated_at_utc: String,
    completed_at_utc: Option<String>,
    notes: Vec<NoteDto>,
}

#[derive(Deserialize, Serialize)]
struct TaskListDto {
    version: String,
    tasks: Vec<TaskDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
enum JsonFileWithHashResult {
    Success { data: TaskListDto, hash: String },
    Missing,
    Invalid { message: String },
    Error { message: String },
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

// Computes SHA-256 hash of a file's raw bytes.
// Called from TypeScript before every write to detect external modifications.
#[tauri::command]
fn hash_file(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(sha256_hex(&bytes))
}

// Reads a JSON file once, parses it, and returns an explicit result with a
// hash of the exact bytes that were read.
#[tauri::command]
fn read_json_file_with_hash(path: &str) -> Result<JsonFileWithHashResult, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(JsonFileWithHashResult::Missing);
        }
        Err(err) => {
            return Ok(JsonFileWithHashResult::Error {
                message: err.to_string(),
            });
        }
    };

    let data = match serde_json::from_slice::<TaskListDto>(&bytes) {
        Ok(data) => data,
        Err(err) => {
            return Ok(JsonFileWithHashResult::Invalid {
                message: err.to_string(),
            });
        }
    };
    let hash = sha256_hex(&bytes);
    Ok(JsonFileWithHashResult::Success { data, hash })
}

// Creates a zip backup from a list of (zip_entry_name, content) pairs.
// The frontend reads each source file inside its per-path serial slot (see
// withSerial in file-system.ts) so the bytes here are guaranteed to be a
// coherent snapshot of one file at one moment — never mid-write.
// Returns the path to the created zip file.
#[tauri::command]
fn create_backup_from_entries(
    entries: Vec<(String, String)>,
    output_path: String,
) -> Result<String, String> {
    // Ensure parent directory exists.
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create backup directory: {}", e))?;
    }

    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create backup file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (entry_name, content) in &entries {
        zip.start_file(entry_name, options)
            .map_err(|e| format!("Failed to add {} to zip: {}", entry_name, e))?;
        std::io::Write::write_all(&mut zip, content.as_bytes())
            .map_err(|e| format!("Failed to write {} to zip: {}", entry_name, e))?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;
    Ok(output_path)
}

// Lists files in a directory, returning their names.
// Used by the frontend to enumerate existing backups for pruning.
#[tauri::command]
fn list_directory(path: String) -> Result<Vec<String>, String> {
    let dir = match std::fs::read_dir(&path) {
        Ok(d) => d,
        Err(_) => return Ok(vec![]), // Directory doesn't exist yet — that's fine.
    };

    let mut names: Vec<String> = Vec::new();
    for entry in dir.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

// Deletes a file. Used to prune old backups.
#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Unique temp directory per call so parallel tests never collide.
    fn unique_temp_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "dropkick-test-{}-{}-{}",
            label,
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sha256_hex_matches_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hash_file_hashes_actual_bytes() {
        let dir = unique_temp_dir("hash");
        let path = dir.join("f.txt");
        std::fs::write(&path, b"abc").unwrap();
        let result = hash_file(path.to_str().unwrap()).unwrap();
        assert_eq!(result, sha256_hex(b"abc"));
    }

    #[test]
    fn read_json_returns_missing_for_absent_file() {
        let dir = unique_temp_dir("read-missing");
        let path = dir.join("nope.json");
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        assert!(matches!(result, JsonFileWithHashResult::Missing));
    }

    #[test]
    fn read_json_returns_invalid_for_bad_json() {
        let dir = unique_temp_dir("read-invalid");
        let path = dir.join("bad.json");
        std::fs::write(&path, b"{ not json").unwrap();
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        assert!(matches!(result, JsonFileWithHashResult::Invalid { .. }));
    }

    #[test]
    fn read_json_returns_success_with_hash() {
        let dir = unique_temp_dir("read-success");
        let path = dir.join("good.json");
        let json = br#"{"version":"1.0.0","tasks":[]}"#;
        std::fs::write(&path, json).unwrap();
        let result = read_json_file_with_hash(path.to_str().unwrap()).unwrap();
        match result {
            JsonFileWithHashResult::Success { data, hash } => {
                assert_eq!(data.version, "1.0.0");
                assert!(data.tasks.is_empty());
                assert_eq!(hash, sha256_hex(json));
            }
            other => panic!("expected Success, got {:?}", serde_json::to_string(&other)),
        }
    }

    #[test]
    fn create_backup_writes_a_readable_zip() {
        let dir = unique_temp_dir("backup");
        let output = dir.join("nested").join("backup.zip");
        let entries = vec![
            ("tasks.json".to_string(), "hello".to_string()),
            ("prefs.json".to_string(), "world".to_string()),
        ];
        let returned =
            create_backup_from_entries(entries, output.to_str().unwrap().to_string()).unwrap();
        assert_eq!(returned, output.to_str().unwrap());
        // Parent directory was created and the file exists.
        assert!(output.exists());

        // Read the zip back and verify both entries and their contents.
        let f = std::fs::File::open(&output).unwrap();
        let mut archive = zip::ZipArchive::new(f).unwrap();
        assert_eq!(archive.len(), 2);

        let mut tasks = String::new();
        archive
            .by_name("tasks.json")
            .unwrap()
            .read_to_string(&mut tasks)
            .unwrap();
        assert_eq!(tasks, "hello");

        let mut prefs = String::new();
        archive
            .by_name("prefs.json")
            .unwrap()
            .read_to_string(&mut prefs)
            .unwrap();
        assert_eq!(prefs, "world");
    }

    #[test]
    fn list_directory_returns_empty_for_missing_dir() {
        let dir = unique_temp_dir("list-missing");
        let missing = dir.join("does-not-exist");
        let result = list_directory(missing.to_str().unwrap().to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn list_directory_returns_sorted_names() {
        let dir = unique_temp_dir("list");
        std::fs::write(dir.join("c.txt"), b"").unwrap();
        std::fs::write(dir.join("a.txt"), b"").unwrap();
        std::fs::write(dir.join("b.txt"), b"").unwrap();
        let result = list_directory(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(result, vec!["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn delete_file_removes_the_file() {
        let dir = unique_temp_dir("delete");
        let path = dir.join("gone.txt");
        std::fs::write(&path, b"x").unwrap();
        assert!(path.exists());
        delete_file(path.to_str().unwrap().to_string()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_errors_for_missing_file() {
        let dir = unique_temp_dir("delete-missing");
        let path = dir.join("nope.txt");
        assert!(delete_file(path.to_str().unwrap().to_string()).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            hash_file,
            read_json_file_with_hash,
            create_backup_from_entries,
            list_directory,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
