use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use hex;
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
struct JsonFileWithHash {
    data: TaskListDto,
    hash: String,
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

// Reads a JSON file once, parses it, and returns the parsed data with a hash
// of the exact bytes that were read. Missing files return None.
#[tauri::command]
fn read_json_file_with_hash(path: &str) -> Result<Option<JsonFileWithHash>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };

    let data = serde_json::from_slice::<TaskListDto>(&bytes).map_err(|e| e.to_string())?;
    let hash = sha256_hex(&bytes);
    Ok(Some(JsonFileWithHash { data, hash }))
}

// Creates a zip backup from a list of (source_path, zip_entry_name) pairs.
// Returns the path to the created zip file.
#[tauri::command]
fn create_backup(entries: Vec<(String, String)>, output_path: String) -> Result<String, String> {
    // Ensure parent directory exists.
    if let Some(parent) = std::path::Path::new(&output_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create backup directory: {}", e))?;
    }

    let file = std::fs::File::create(&output_path)
        .map_err(|e| format!("Failed to create backup file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (source_path, entry_name) in &entries {
        let bytes = match std::fs::read(source_path) {
            Ok(b) => b,
            Err(e) => {
                // Skip files that can't be read (e.g. deleted between check and backup).
                eprintln!("[backup] Skipping {}: {}", source_path, e);
                continue;
            }
        };

        zip.start_file(entry_name, options)
            .map_err(|e| format!("Failed to add {} to zip: {}", entry_name, e))?;
        std::io::Write::write_all(&mut zip, &bytes)
            .map_err(|e| format!("Failed to write {} to zip: {}", entry_name, e))?;
    }

    zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;
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
    for entry in dir {
        if let Ok(entry) = entry {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
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
            create_backup,
            list_directory,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
