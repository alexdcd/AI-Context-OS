use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

use crate::core::index::{memory_folder, scan_memories};
use crate::core::memory::{read_memory, write_memory};
use crate::core::types::{CreateMemoryInput, Memory, MemoryFilter, MemoryMeta, MemoryType, SaveMemoryInput};
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
/// Auto-increments access_count and updates last_access on every read.
#[tauri::command]
pub fn get_memory(id: String, state: State<AppState>) -> Result<Memory, String> {
    let index = state.memory_index.read().unwrap();

    let (_meta, path) = index
        .get(&id)
        .ok_or_else(|| format!("Memory not found: {}", id))?;

    let mut memory = read_memory(std::path::Path::new(path))?;

    // Update access tracking
    memory.meta.access_count += 1;
    memory.meta.last_access = Utc::now();

    // Persist updated counters to disk
    write_memory(std::path::Path::new(path), &memory)?;

    // Update in-memory index
    drop(index);
    let mut index = state.memory_index.write().unwrap();
    if let Some(entry) = index.get_mut(&id) {
        entry.0.access_count = memory.meta.access_count;
        entry.0.last_access = memory.meta.last_access;
    }

    Ok(memory)
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
    create_memory_internal(input, folder, app, state)
}

/// Create a new memory file inside a specific directory.
#[tauri::command]
pub fn create_memory_at_path(
    input: CreateMemoryInput,
    parent_dir: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    create_memory_internal(input, PathBuf::from(parent_dir), app, state)
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
    let (old_meta, path) = index
        .get(&input.id)
        .ok_or_else(|| format!("Memory not found: {}", input.id))?;
    let old_file_path = PathBuf::from(path.clone());
    let old_memory_type = old_meta.memory_type.clone();

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

    let target_parent = if meta.memory_type == old_memory_type {
        old_file_path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| memory_folder(&root, &meta.memory_type))
    } else {
        memory_folder(&root, &meta.memory_type)
    };
    let target_file_path = target_parent.join(format!("{}.md", meta.id));
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

/// Rename a memory file in place, preserving its current directory.
#[tauri::command]
pub fn rename_memory_file(
    path: String,
    new_id: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let old_path = PathBuf::from(&path);
    if !old_path.exists() {
        return Err(format!("Memory path not found: {}", path));
    }

    let mut memory = read_memory(&old_path)?;
    let old_id = memory.meta.id.clone();
    let trimmed_id = new_id.trim();
    if trimmed_id.is_empty() {
        return Err("Memory id cannot be empty".to_string());
    }

    let index = state.memory_index.read().unwrap();
    if let Some((_meta, existing_path)) = index.get(trimmed_id) {
        if existing_path != &path {
            return Err(format!("Memory already exists: {}", trimmed_id));
        }
    }
    drop(index);

    let new_path = old_path.with_file_name(format!("{}.md", trimmed_id));
    if new_path.exists() && new_path != old_path {
        return Err(format!("A memory file already exists at {}", new_path.display()));
    }

    memory.meta.id = trimmed_id.to_string();
    memory.meta.modified = Utc::now();
    memory.meta.version += 1;
    memory.file_path = new_path.to_string_lossy().to_string();

    write_memory(&new_path, &memory)?;
    if new_path != old_path {
        fs::remove_file(&old_path).map_err(|e| {
            format!(
                "Failed to rename memory file {} to {}: {}",
                old_path.display(),
                new_path.display(),
                e
            )
        })?;
    }

    let mut index = state.memory_index.write().unwrap();
    index.remove(&old_id);
    index.insert(
        memory.meta.id.clone(),
        (memory.meta.clone(), new_path.to_string_lossy().to_string()),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

/// Duplicate a memory file in place using a new unique id.
#[tauri::command]
pub fn duplicate_memory_file(
    path: String,
    new_id: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let source_path = PathBuf::from(&path);
    if !source_path.exists() {
        return Err(format!("Memory path not found: {}", path));
    }

    let source = read_memory(&source_path)?;
    let trimmed_id = new_id.trim();
    if trimmed_id.is_empty() {
        return Err("Memory id cannot be empty".to_string());
    }

    let index = state.memory_index.read().unwrap();
    if index.contains_key(trimmed_id) {
        return Err(format!("Memory already exists: {}", trimmed_id));
    }
    drop(index);

    let target_path = source_path.with_file_name(format!("{}.md", trimmed_id));
    if target_path.exists() {
        return Err(format!("A memory file already exists at {}", target_path.display()));
    }

    let now = Utc::now();
    let memory = Memory {
        meta: MemoryMeta {
            id: trimmed_id.to_string(),
            memory_type: source.meta.memory_type,
            l0: source.meta.l0,
            importance: source.meta.importance,
            always_load: source.meta.always_load,
            decay_rate: source.meta.decay_rate,
            last_access: now,
            access_count: 0,
            confidence: source.meta.confidence,
            tags: source.meta.tags,
            related: source.meta.related,
            created: now,
            modified: now,
            version: 1,
            triggers: source.meta.triggers,
            requires: source.meta.requires,
            optional: source.meta.optional,
            output_format: source.meta.output_format,
        },
        l1_content: source.l1_content,
        l2_content: source.l2_content,
        raw_content: String::new(),
        file_path: target_path.to_string_lossy().to_string(),
    };

    write_memory(&target_path, &memory)?;

    let mut index = state.memory_index.write().unwrap();
    index.insert(
        memory.meta.id.clone(),
        (memory.meta.clone(), target_path.to_string_lossy().to_string()),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

/// Move a memory file into another workspace folder, updating its type when needed.
#[tauri::command]
pub fn move_memory_file(
    path: String,
    destination_dir: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let source_path = PathBuf::from(&path);
    if !source_path.exists() {
        return Err(format!("Memory path not found: {}", path));
    }

    let destination_dir = PathBuf::from(&destination_dir);
    if !destination_dir.exists() {
        return Err(format!("Destination does not exist: {}", destination_dir.display()));
    }
    if !destination_dir.is_dir() {
        return Err(format!("Destination is not a directory: {}", destination_dir.display()));
    }

    let root = state.get_root();
    let destination_type = memory_type_for_directory(&root, &destination_dir)?;

    let mut memory = read_memory(&source_path)?;
    let target_path = destination_dir.join(format!("{}.md", memory.meta.id));
    if target_path == source_path {
        return Ok(memory);
    }
    if target_path.exists() {
        return Err(format!("A memory file already exists at {}", target_path.display()));
    }

    let old_id = memory.meta.id.clone();
    memory.meta.memory_type = destination_type;
    memory.meta.modified = Utc::now();
    memory.meta.version += 1;
    memory.file_path = target_path.to_string_lossy().to_string();

    write_memory(&target_path, &memory)?;
    fs::remove_file(&source_path).map_err(|e| {
        format!(
            "Failed to move memory file {} to {}: {}",
            source_path.display(),
            target_path.display(),
            e
        )
    })?;

    let mut index = state.memory_index.write().unwrap();
    index.insert(
        old_id,
        (memory.meta.clone(), target_path.to_string_lossy().to_string()),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

fn create_memory_internal(
    input: CreateMemoryInput,
    parent_dir: PathBuf,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let trimmed_id = input.id.trim();
    if trimmed_id.is_empty() {
        return Err("Memory id cannot be empty".to_string());
    }

    let index = state.memory_index.read().unwrap();
    if index.contains_key(trimmed_id) {
        return Err(format!("Memory already exists: {}", trimmed_id));
    }
    drop(index);

    let file_path = parent_dir.join(format!("{}.md", trimmed_id));
    if file_path.exists() {
        return Err(format!("Memory already exists at {}", file_path.display()));
    }

    let now = Utc::now();
    let meta = MemoryMeta {
        id: trimmed_id.to_string(),
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

fn memory_type_for_directory(root: &std::path::Path, dir: &std::path::Path) -> Result<MemoryType, String> {
    let relative = dir
        .strip_prefix(root)
        .map_err(|_| format!("Destination must stay inside the workspace: {}", dir.display()))?;
    let folder = relative
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .ok_or_else(|| format!("Failed to infer memory type from {}", dir.display()))?;

    MemoryType::from_folder(folder)
        .ok_or_else(|| format!("Destination must be inside a memory folder: {}", dir.display()))
}
