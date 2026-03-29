use std::fs;
use std::path::Path;

use tauri::{AppHandle, Emitter, State};

use crate::core::compat::{render_claude_adapter, render_cursor_adapter, render_windsurf_adapter};
use crate::core::index::scan_memories;
use crate::core::router::{generate_router_content, generate_index_yaml};
use crate::core::types::{Config, MemoryMeta};
use crate::state::AppState;

fn regenerate_router_files(
    root: &Path,
    config: &Config,
) -> Result<(String, Vec<(MemoryMeta, String)>), String> {
    let all = scan_memories(root);
    let metas: Vec<_> = all.iter().map(|(m, _)| m.clone()).collect();

    // Generate neutral router content (source of truth)
    let neutral = generate_router_content(&metas, config);

    // Write adapter artifacts from neutral content
    let claude_md = render_claude_adapter(&neutral);
    fs::write(root.join("claude.md"), &claude_md)
        .map_err(|e| format!("Failed to write claude.md: {}", e))?;

    let cursorrules = render_cursor_adapter(&neutral);
    fs::write(root.join(".cursorrules"), &cursorrules)
        .map_err(|e| format!("Failed to write .cursorrules: {}", e))?;

    let windsurfrules = render_windsurf_adapter(&neutral);
    fs::write(root.join(".windsurfrules"), &windsurfrules)
        .map_err(|e| format!("Failed to write .windsurfrules: {}", e))?;

    // Generate _index.yaml (independent of adapters)
    let index_yaml = generate_index_yaml(&metas);
    fs::write(root.join("_index.yaml"), &index_yaml)
        .map_err(|e| format!("Failed to write _index.yaml: {}", e))?;

    Ok((claude_md, all))
}

pub fn regenerate_router_internal(
    app: &AppHandle,
    state: &State<AppState>,
) -> Result<String, String> {
    let root = state.get_root();
    let config = state.config.read().unwrap().clone();

    let (claude_md, all) = regenerate_router_files(&root, &config)?;

    // Update memory index in state
    let mut index = state.memory_index.write().unwrap();
    index.clear();
    for (meta, path) in all {
        index.insert(meta.id.clone(), (meta, path));
    }

    let _ = app.emit("router-regenerated", ());
    Ok(claude_md)
}

/// Regenerate claude.md, _index.yaml, .cursorrules, .windsurfrules.
#[tauri::command]
pub fn regenerate_router(app: AppHandle, state: State<AppState>) -> Result<String, String> {
    regenerate_router_internal(&app, &state)
}

/// Get the current claude.md content.
#[tauri::command]
pub fn get_router_content(state: State<AppState>) -> Result<String, String> {
    let root = state.get_root();
    let path = root.join("claude.md");

    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Failed to read claude.md: {}", e))
    } else {
        Ok("Router not initialized yet.".to_string())
    }
}
