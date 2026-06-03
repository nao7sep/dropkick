use hex;
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
            create_backup_from_entries,
            list_directory,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
