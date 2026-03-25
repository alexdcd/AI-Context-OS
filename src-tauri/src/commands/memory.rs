use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

use crate::core::index::{memory_folder, scan_memories};
use crate::core::memory::{read_memory, write_memory};
use crate::core::types::{CreateMemoryInput, Memory, MemoryFilter, MemoryMeta, SaveMemoryInput};
use crate::state::AppState;

/// List all memory metadata (L0 level).
#[tauri::command]
pub fn list_memories(
    filter: Option<MemoryFilter>,
    state: State<AppState>,
) -> Result<Vec<MemoryMeta>, String> {
    let root = state.get_root();
    let all = scan_memories(&root);

    let metas: Vec<MemoryMeta> = all
        .into_iter()
        .map(|(meta, _path)| meta)
        .filter(|m| {
            if let Some(ref f) = filter {
                if let Some(ref ft) = f.memory_type {
                    if &m.memory_type != ft {
                        return false;
                    }
                }
                if let Some(ref min_imp) = f.min_importance {
                    if m.importance < *min_imp {
                        return false;
                    }
                }
                if let Some(ref tags) = f.tags {
                    if !tags.iter().any(|t| m.tags.contains(t)) {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    // Update the in-memory index
    let mut index = state.memory_index.write().unwrap();
    index.clear();
    let all_again = scan_memories(&root);
    for (meta, path) in all_again {
        index.insert(meta.id.clone(), (meta, path));
    }

    Ok(metas)
}

/// Get a full memory with L1+L2 content.
#[tauri::command]
pub fn get_memory(id: String, state: State<AppState>) -> Result<Memory, String> {
    let index = state.memory_index.read().unwrap();

    let (_meta, path) = index
        .get(&id)
        .ok_or_else(|| format!("Memory not found: {}", id))?;

    read_memory(std::path::Path::new(path))
}

/// Create a new memory file.
#[tauri::command]
pub fn create_memory(
    input: CreateMemoryInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let root = state.get_root();
    let folder = memory_folder(&root, &input.memory_type);
    let filename = format!("{}.md", input.id);
    let file_path = folder.join(&filename);

    if file_path.exists() {
        return Err(format!("Memory already exists: {}", input.id));
    }

    let now = Utc::now();
    let meta = MemoryMeta {
        id: input.id.clone(),
        memory_type: input.memory_type,
        l0: input.l0,
        importance: input.importance,
        always_load: false,
        decay_rate: 0.998,
        last_access: now,
        access_count: 0,
        confidence: 0.9,
        tags: input.tags,
        related: Vec::new(),
        created: now,
        modified: now,
        version: 1,
        triggers: Vec::new(),
        requires: Vec::new(),
        optional: Vec::new(),
        output_format: None,
    };

    let memory = Memory {
        meta,
        l1_content: input.l1_content,
        l2_content: input.l2_content,
        raw_content: String::new(),
        file_path: file_path.to_string_lossy().to_string(),
    };

    write_memory(&file_path, &memory)?;

    // Update index
    let mut index = state.memory_index.write().unwrap();
    index.insert(
        memory.meta.id.clone(),
        (memory.meta.clone(), file_path.to_string_lossy().to_string()),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

/// Save/update an existing memory.
#[tauri::command]
pub fn save_memory(
    input: SaveMemoryInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let root = state.get_root();
    let index = state.memory_index.read().unwrap();
    let (_old_meta, path) = index
        .get(&input.id)
        .ok_or_else(|| format!("Memory not found: {}", input.id))?;
    let old_file_path = PathBuf::from(path.clone());

    if input.meta.id.trim().is_empty() {
        return Err("Memory id cannot be empty".to_string());
    }
    if input.meta.id != input.id && index.contains_key(&input.meta.id) {
        return Err(format!("Memory already exists: {}", input.meta.id));
    }
    drop(index);

    let mut meta = input.meta;
    meta.modified = Utc::now();
    meta.version += 1;
    meta.id = meta.id.trim().to_string();

    let target_file_path = memory_folder(&root, &meta.memory_type).join(format!("{}.md", meta.id));
    if target_file_path.exists() && target_file_path != old_file_path {
        return Err(format!(
            "A memory file already exists at {}",
            target_file_path.display()
        ));
    }

    let memory = Memory {
        meta,
        l1_content: input.l1_content,
        l2_content: input.l2_content,
        raw_content: String::new(),
        file_path: target_file_path.to_string_lossy().to_string(),
    };

    write_memory(&target_file_path, &memory)?;
    if target_file_path != old_file_path && old_file_path.exists() {
        fs::remove_file(&old_file_path)
            .map_err(|e| format!("Failed to move memory file {}: {}", old_file_path.display(), e))?;
    }

    // Update index
    let mut index = state.memory_index.write().unwrap();
    index.remove(&input.id);
    index.insert(
        memory.meta.id.clone(),
        (
            memory.meta.clone(),
            target_file_path.to_string_lossy().to_string(),
        ),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

/// Delete a memory file.
#[tauri::command]
pub fn delete_memory(
    id: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let mut index = state.memory_index.write().unwrap();
    let (_meta, path) = index
        .remove(&id)
        .ok_or_else(|| format!("Memory not found: {}", id))?;
    drop(index);

    fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path, e))?;

    let _ = app.emit("file-deleted", &path);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(())
}
