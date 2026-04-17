use std::fs;
use std::path::Path;

use crate::core::folder_contract::{check_required_fields, load_folder_contract};
use crate::core::frontmatter::parse_frontmatter;
use crate::core::paths::{enrich_memory_meta, AI_DIR, AI_SKIP_SUBDIRS, INBOX_DIR, SCAN_SKIP_DIRS};
use crate::core::types::MemoryMeta;
use crate::core::usage::{apply_usage, load_usage_map};

/// Scan the entire workspace recursively and collect all memory metadata.
/// Files are identified as memories by having valid YAML frontmatter with a `type` field.
/// Skips .git, node_modules, .cache, and files starting with `_`.
pub fn scan_memories(root: &Path) -> Vec<(MemoryMeta, String)> {
    let mut results = Vec::new();
    let usage = load_usage_map(root);
    scan_dir_recursive(root, root, &usage, &mut results);
    results
}
fn scan_dir_recursive(
    root: &Path,
    dir: &Path,
    usage: &std::collections::HashMap<String, crate::core::usage::MemoryUsageEntry>,
    results: &mut Vec<(MemoryMeta, String)>,
) {
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
            // Inbox is a transient capture surface and does not participate
            // in canonical memory retrieval until explicit promotion.
            if dir == root && name.as_ref() == INBOX_DIR {
                continue;
            }
            // Skip system-managed .ai/ subdirs that don't contain memory files
            if dir.file_name().map_or(false, |d| d == AI_DIR)
                && AI_SKIP_SUBDIRS.iter().any(|skip| *skip == name.as_ref())
            {
                continue;
            }
            scan_dir_recursive(root, &path, usage, results);
        } else if path.extension().map_or(false, |ext| ext == "md") {
            // Skip files starting with _ (like _project.md templates)
            if name.starts_with('_') {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                match parse_frontmatter(&content) {
                    Ok((mut meta, _)) => {
                        enrich_memory_meta(&mut meta, &path, root);
                        let meta_id = meta.id.clone();
                        apply_usage(&mut meta, usage.get(&meta_id));

                        // Warn if the memory violates its folder contract.
                        // Non-fatal: existing workspaces and migrations are not broken.
                        if let Some(parent) = path.parent() {
                            if let Some(contract) = load_folder_contract(parent) {
                                for violation in check_required_fields(&meta, &contract) {
                                    log::warn!(
                                        "Memory '{}' violates folder contract (role: {}): {}",
                                        meta_id,
                                        contract.role,
                                        violation
                                    );
                                }
                            }
                        }

                        results.push((meta, path.to_string_lossy().to_string()));
                    }
                    Err(err) => {
                        // Bare markdown files are left untouched. They remain regular documents
                        // until the user explicitly converts them into canonical memories.
                        // When frontmatter IS present but fails YAML validation, the memory is
                        // silently dropped from the retrieval index — which historically masked
                        // schema drift (e.g. new `type` variants emitted by the UI that the
                        // parser didn't yet know about). Surface that case as a warning so the
                        // user can see *why* their memories aren't showing up in chat context.
                        if matches!(
                            err,
                            crate::core::frontmatter::FrontmatterError::YamlError(_)
                        ) {
                            log::warn!(
                                "scan_memories: rejected '{}' — frontmatter present but failed to parse: {}",
                                path.display(),
                                err
                            );
                        }
                    }
                }
            }
        }
    }
}
