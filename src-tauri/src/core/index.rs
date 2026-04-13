use std::fs;
use std::path::Path;

use chrono::Utc;

use crate::core::frontmatter::{parse_frontmatter, serialize_frontmatter};
use crate::core::paths::{enrich_memory_meta, AI_DIR, AI_SKIP_SUBDIRS, SCAN_SKIP_DIRS};
use crate::core::types::{MemoryMeta, MemoryOntology};

/// Scan the entire workspace recursively and collect all memory metadata.
/// Files are identified as memories by having valid YAML frontmatter with a `type` field.
/// Skips .git, node_modules, .cache, and files starting with `_`.
pub fn scan_memories(root: &Path) -> Vec<(MemoryMeta, String)> {
    let mut results = Vec::new();
    scan_dir_recursive(root, root, &mut results);
    results
}

fn scan_dir_recursive(root: &Path, dir: &Path, results: &mut Vec<(MemoryMeta, String)>) {
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
            // Skip system-managed .ai/ subdirs that don't contain memory files
            if dir.file_name().map_or(false, |d| d == AI_DIR)
                && AI_SKIP_SUBDIRS.iter().any(|skip| *skip == name.as_ref())
            {
                continue;
            }
            scan_dir_recursive(root, &path, results);
        } else if path.extension().map_or(false, |ext| ext == "md") {
            // Skip files starting with _ (like _project.md templates)
            if name.starts_with('_') {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                match parse_frontmatter(&content) {
                    Ok((mut meta, _)) => {
                        enrich_memory_meta(&mut meta, &path, root);
                        results.push((meta, path.to_string_lossy().to_string()));
                    }
                    Err(_) => {
                        // Bare .md file (no frontmatter) — auto-inject minimal frontmatter
                        // so the app recognizes it as an editable Memory instead of raw TEXT.
                        if let Some(stem) = path.file_stem() {
                            let raw_stem = stem.to_string_lossy();
                            let id = raw_stem
                                .to_lowercase()
                                .chars()
                                .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
                                .collect::<String>();
                            let mut meta = MemoryMeta {
                                id,
                                ontology: MemoryOntology::Entity,
                                l0: raw_stem.to_string(),
                                importance: 0.5,
                                always_load: false,
                                decay_rate: 0.998,
                                last_access: Utc::now(),
                                access_count: 0,
                                confidence: 0.9,
                                tags: vec![],
                                related: vec![],
                                created: Utc::now(),
                                modified: Utc::now(),
                                version: 1,
                                triggers: vec![],
                                requires: vec![],
                                optional: vec![],
                                output_format: None,
                                status: None,
                                protected: false,
                                derived_from: vec![],
                                folder_category: None,
                                system_role: None,
                            };
                            if let Ok(new_content) = serialize_frontmatter(&meta, &content) {
                                let _ = fs::write(&path, &new_content);
                            }
                            enrich_memory_meta(&mut meta, &path, root);
                            results.push((meta, path.to_string_lossy().to_string()));
                        }
                    }
                }
            }
        }
    }
}
