use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::State;

use crate::core::index::scan_memories;
use crate::core::paths::SystemPaths;
use crate::core::types::FileNode;
use crate::state::AppState;

const SPECIAL_ROOT_ORDER: [&str; 3] = ["inbox", "sources", ".ai"];

/// Get the file tree of the workspace.
#[tauri::command]
pub fn get_file_tree(state: State<AppState>) -> Result<Vec<FileNode>, String> {
    let root = state.get_root();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let children = read_dir_recursive(&root, 0)?;
    Ok(children)
}

fn read_dir_recursive(dir: &Path, depth: u32) -> Result<Vec<FileNode>, String> {
    if depth > 5 {
        return Ok(Vec::new()); // Prevent infinite recursion
    }

    let mut entries: Vec<FileNode> = Vec::new();
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/dirs (except .ai and .cache)
        if name.starts_with('.') && name != ".ai" && name != ".cache" {
            continue;
        }

        let is_dir = path.is_dir();
        let children = if is_dir {
            read_dir_recursive(&path, depth + 1)?
        } else {
            Vec::new()
        };

        entries.push(FileNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            children,
        });
    }

    // Sort: special workspace dirs first at root, then directories, then alphabetically.
    entries.sort_by(|a, b| {
        if depth == 0 {
            let a_special = SPECIAL_ROOT_ORDER.iter().position(|name| *name == a.name);
            let b_special = SPECIAL_ROOT_ORDER.iter().position(|name| *name == b.name);
            match (a_special, b_special) {
                (Some(a_idx), Some(b_idx)) => return a_idx.cmp(&b_idx),
                (Some(_), None) => return std::cmp::Ordering::Less,
                (None, Some(_)) => return std::cmp::Ordering::Greater,
                (None, None) => {}
            }
        }

        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(entries)
}

fn normalize_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn generated_artifact_paths(root: &Path) -> Vec<PathBuf> {
    let paths = SystemPaths::new(root);
    vec![
        paths.claude_md(),
        paths.cursorrules(),
        paths.windsurfrules(),
        paths.config_yaml(),
        paths.index_yaml(),
        paths.catalog_md(),
    ]
}

fn protected_memory_paths(root: &Path) -> Vec<(String, PathBuf)> {
    scan_memories(root)
        .into_iter()
        .filter(|(meta, _)| meta.protected)
        .map(|(meta, path)| (meta.id, normalize_path(Path::new(&path))))
        .collect()
}

fn path_contains_protected_content(root: &Path, target: &Path) -> Option<String> {
    let normalized_target = normalize_path(target);
    let paths = SystemPaths::new(root);

    for reserved in [paths.ai_dir(), paths.inbox_dir(), paths.sources_dir()] {
        if normalize_path(&reserved) == normalized_target {
            return Some(format!(
                "Directory '{}' is system-managed and cannot be changed directly.",
                target.display()
            ));
        }
    }

    for artifact in generated_artifact_paths(root) {
        let normalized_artifact = normalize_path(&artifact);
        if normalized_artifact == normalized_target
            || normalized_artifact.starts_with(&normalized_target)
        {
            return Some(format!(
                "Generated artifact '{}' cannot be changed directly.",
                artifact.display()
            ));
        }
    }

    for (memory_id, memory_path) in protected_memory_paths(root) {
        if memory_path == normalized_target || memory_path.starts_with(&normalized_target) {
            return Some(format!(
                "Memory '{}' is protected. Unprotect it before changing this path.",
                memory_id
            ));
        }
    }

    None
}

/// Read a file's raw content.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Write raw content to a file.
#[tauri::command]
pub fn write_file(path: String, content: String, state: State<AppState>) -> Result<(), String> {
    let root = state.get_root();
    if let Some(error) = path_contains_protected_content(&root, Path::new(&path)) {
        return Err(error);
    }
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path, e))?;
    state.mark_recent_write(Path::new(&path));
    Ok(())
}

/// Create a directory and any missing parent directories.
#[tauri::command]
pub fn create_directory(path: String) -> Result<String, String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory {}: {}", path, e))?;
    Ok(path)
}

/// Rename or move a file or directory.
#[tauri::command]
pub fn rename_path(
    old_path: String,
    new_path: String,
    state: State<AppState>,
) -> Result<String, String> {
    let old = PathBuf::from(&old_path);
    let new = PathBuf::from(&new_path);
    let root = state.get_root();

    if !old.exists() {
        return Err(format!("Path does not exist: {}", old_path));
    }
    if let Some(error) = path_contains_protected_content(&root, &old) {
        return Err(error);
    }
    if new.exists() && new != old {
        return Err(format!("Target already exists: {}", new_path));
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create target directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    fs::rename(&old, &new)
        .map_err(|e| format!("Failed to rename {} to {}: {}", old_path, new_path, e))?;
    Ok(new.to_string_lossy().to_string())
}

/// Delete a file or directory recursively.
#[tauri::command]
pub fn delete_path(path: String, state: State<AppState>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let root = state.get_root();
    if !target.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if let Some(error) = path_contains_protected_content(&root, &target) {
        return Err(error);
    }

    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|e| format!("Failed to delete directory {}: {}", path, e))?;
    } else {
        fs::remove_file(&target).map_err(|e| format!("Failed to delete file {}: {}", path, e))?;
    }

    Ok(())
}

/// Duplicate a raw file alongside the original using a unique sibling name.
#[tauri::command]
pub fn duplicate_file(path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if source.is_dir() {
        return Err("Directory duplication is not supported".to_string());
    }

    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Invalid file name for {}", path))?;
    let parent = source
        .parent()
        .ok_or_else(|| format!("Failed to resolve parent directory for {}", path))?;

    let duplicate = unique_duplicate_path(parent, file_name);
    fs::copy(&source, &duplicate).map_err(|e| {
        format!(
            "Failed to duplicate {} to {}: {}",
            path,
            duplicate.display(),
            e
        )
    })?;

    Ok(duplicate.to_string_lossy().to_string())
}

/// Reveal a path in the system file manager.
#[tauri::command]
pub fn show_in_file_manager(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&target)
            .status()
            .map_err(|e| format!("Failed to reveal {} in Finder: {}", path, e))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", target.to_string_lossy());
        Command::new("explorer")
            .arg(arg)
            .status()
            .map_err(|e| format!("Failed to reveal {} in Explorer: {}", path, e))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let directory = if target.is_dir() {
            target
        } else {
            target
                .parent()
                .map(PathBuf::from)
                .ok_or_else(|| format!("Failed to resolve parent directory for {}", path))?
        };
        Command::new("xdg-open")
            .arg(directory)
            .status()
            .map_err(|e| format!("Failed to reveal {} in file manager: {}", path, e))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Show in file manager is not supported on this platform".to_string())
}

fn unique_duplicate_path(parent: &Path, file_name: &str) -> PathBuf {
    let original = Path::new(file_name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    let ext = original.extension().and_then(|value| value.to_str());

    let mut counter = 0;
    loop {
        let suffix = if counter == 0 {
            "-copy".to_string()
        } else {
            format!("-copy-{}", counter + 1)
        };
        let candidate_name = match ext {
            Some(ext) => format!("{}{}.{}", stem, suffix, ext),
            None => format!("{}{}", stem, suffix),
        };
        let candidate = parent.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}
