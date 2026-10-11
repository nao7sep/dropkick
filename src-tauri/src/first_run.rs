//! First-run documents are new user files, never replacements. Each publication
//! is atomic; a later failure keeps earlier documents available for reopening.
use std::path::{Path, PathBuf};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialDocuments {
    pub preferences_path: String,
    pub workspace_path: String,
    pub task_list_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Failure {
    pub code: &'static str,
    // Diagnostics are logged at the command boundary, not sent as UI copy.
    #[serde(skip)]
    pub diagnostic: String,
}

impl Failure {
    pub fn failed(diagnostic: impl Into<String>) -> Self {
        Self { code: "failed", diagnostic: diagnostic.into() }
    }
}

pub fn create(
    directory: &Path,
    preferences: Value,
    workspace: Value,
    task_list: Option<Value>,
    task_list_name: &str,
) -> Result<InitialDocuments, Failure> {
    create_with_writer(directory, preferences, workspace, task_list, task_list_name, |path, contents| {
        let path_text = path.to_str().ok_or_else(|| "setup path is not UTF-8".to_string())?;
        crate::write_atomic_impl(path_text, contents, true, true).map(|_| ())
    })
}

fn create_with_writer(
    directory: &Path,
    preferences: Value,
    mut workspace: Value,
    task_list: Option<Value>,
    task_list_name: &str,
    mut write: impl FnMut(&Path, &str) -> Result<(), String>,
) -> Result<InitialDocuments, Failure> {
    if !directory.is_absolute() {
        return Err(Failure::failed("setup directory must be absolute"));
    }
    let preferences_path = directory.join("preferences.json");
    let workspace_path = directory.join("workspace.json");
    let task_list_path = task_list.as_ref().map(|_| directory.join("tasks.json"));
    if let Some(path) = &task_list_path {
        let map = workspace.as_object_mut().ok_or_else(|| Failure::failed("workspace is not an object"))?;
        map.insert("openTabs".into(), json!([{
            "filePath": path,
            "displayName": task_list_name,
            "isUnifiedView": false,
        }]));
    }
    let mut documents: Vec<(PathBuf, Value)> = vec![(preferences_path.clone(), preferences)];
    // Publish a task list before a workspace that refers to it.
    if let (Some(path), Some(document)) = (&task_list_path, task_list) {
        documents.push((path.clone(), document));
    }
    documents.push((workspace_path.clone(), workspace));

    // Avoid a predictable partial setup, while exclusive publication below
    // still handles another writer creating any target after this check.
    for (path, _) in &documents {
        match std::fs::symlink_metadata(path) {
            Ok(_) => return Err(Failure { code: "occupied", diagnostic: format!("{} already exists", path.display()) }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(Failure::failed(format!("{}: {error}", path.display()))),
        }
    }
    std::fs::create_dir_all(directory).map_err(|error| Failure::failed(error.to_string()))?;
    for (path, document) in documents {
        let contents = serde_json::to_string_pretty(&document).map_err(|error| Failure::failed(error.to_string()))?;
        write(&path, &contents)
            .map_err(|error| Failure::failed(format!("{}: {error}", path.display())))?;
    }
    Ok(InitialDocuments {
        preferences_path: preferences_path.to_string_lossy().into_owned(),
        workspace_path: workspace_path.to_string_lossy().into_owned(),
        task_list_path: task_list_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
#[path = "../tests/unit/first_run.rs"]
mod tests;
