use std::fs;
use std::path::Path;

use crate::core::frontmatter::parse_frontmatter;
use crate::core::types::{MemoryMeta, MemoryType};

/// Scan the workspace directory and collect all memory metadata.
pub fn scan_memories(root: &Path) -> Vec<(MemoryMeta, String)> {
    let mut results = Vec::new();

    let folders = [
        "01-context",
        "02-daily",
        "03-intelligence",
        "04-projects",
        "05-resources",
        "06-skills",
        "07-tasks",
        "08-rules",
        "09-scratch",
    ];

    for folder in &folders {
        let folder_path = root.join(folder);
        if !folder_path.exists() {
            continue;
        }
        scan_folder_recursive(&folder_path, &mut results);
    }

    results
}

fn scan_folder_recursive(dir: &Path, results: &mut Vec<(MemoryMeta, String)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_folder_recursive(&path, results);
        } else if path.extension().map_or(false, |ext| ext == "md") {
            // Skip files starting with _ (like _project.md templates)
            let fname = path.file_name().unwrap_or_default().to_string_lossy();
            if fname.starts_with('_') && fname != "_project.md" {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(content) => {
                    if let Ok((meta, _)) = parse_frontmatter(&content) {
                        results.push((meta, path.to_string_lossy().to_string()));
                    }
                }
                Err(_) => continue,
            }
        }
    }
}

/// Get the folder path for a memory type.
pub fn memory_folder(root: &Path, memory_type: &MemoryType) -> std::path::PathBuf {
    root.join(memory_type.folder_name())
}
