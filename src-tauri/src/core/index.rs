use std::fs;
use std::path::Path;

use crate::core::frontmatter::parse_frontmatter;
use crate::core::paths::SCAN_SKIP_DIRS;
use crate::core::types::MemoryMeta;

/// Scan the entire workspace recursively and collect all memory metadata.
/// Files are identified as memories by having valid YAML frontmatter with a `type` field.
/// Skips .git, node_modules, .cache, and files starting with `_`.
pub fn scan_memories(root: &Path) -> Vec<(MemoryMeta, String)> {
    let mut results = Vec::new();
    scan_dir_recursive(root, &mut results);
    results
}

fn scan_dir_recursive(dir: &Path, results: &mut Vec<(MemoryMeta, String)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy();

        if path.is_dir() {
            // Skip directories that should never be scanned
            if SCAN_SKIP_DIRS.iter().any(|skip| *skip == name.as_ref()) {
                continue;
            }
            scan_dir_recursive(&path, results);
        } else if path.extension().map_or(false, |ext| ext == "md") {
            // Skip files starting with _ (like _project.md templates)
            if name.starts_with('_') {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok((meta, _)) = parse_frontmatter(&content) {
                    results.push((meta, path.to_string_lossy().to_string()));
                }
            }
        }
    }
}
