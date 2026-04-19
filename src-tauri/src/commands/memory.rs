use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use tauri::{AppHandle, Emitter, State};

use crate::core::index::scan_memories;
use crate::core::memory::{read_memory, write_memory};
use crate::core::paths::{enrich_memory_meta, SystemPaths};
use crate::core::types::{CreateMemoryInput, Memory, MemoryFilter, MemoryMeta, SaveMemoryInput};
use crate::core::usage::record_access;
use crate::core::wikilinks::{
    find_backlink_occurrences, normalize_wikilinks, resolve_wikilink, rewrite_wikilink_target,
    BacklinkOccurrence, CascadeRewriteOutcome, NormalizationOutcome, SaveMemoryResult,
    WikilinkResolution, WikilinkSaveWarning,
};
use crate::state::AppState;

/// Normalize wikilinks in L1 and L2 against the current memory index.
/// Returns normalized bodies and warnings tagged per body section.
/// `self_id` is excluded so a memory doesn't canonicalize links to itself
/// using its own l0 when the edit is also renaming l0.
fn normalize_memory_bodies(
    l1: &str,
    l2: &str,
    memories: &[MemoryMeta],
    self_id: &str,
) -> (String, String, Vec<WikilinkSaveWarning>) {
    let filtered: Vec<MemoryMeta> = memories
        .iter()
        .filter(|m| m.id != self_id)
        .cloned()
        .collect();

    let NormalizationOutcome {
        body: new_l1,
        warnings: l1_warnings,
        ..
    } = normalize_wikilinks(l1, &filtered);
    let NormalizationOutcome {
        body: new_l2,
        warnings: l2_warnings,
        ..
    } = normalize_wikilinks(l2, &filtered);

    let mut warnings: Vec<WikilinkSaveWarning> =
        Vec::with_capacity(l1_warnings.len() + l2_warnings.len());
    for w in l1_warnings {
        warnings.push(WikilinkSaveWarning {
            level: "l1".to_string(),
            warning: w,
        });
    }
    for w in l2_warnings {
        warnings.push(WikilinkSaveWarning {
            level: "l2".to_string(),
            warning: w,
        });
    }

    (new_l1, new_l2, warnings)
}

/// Rewrite every `[[old_id]]` occurrence in every canonical memory's body to
/// `[[new_id]]`. Runs *after* the renamed memory has been written, so the new
/// file is already on disk with its new id.
///
/// Scope is limited to memories indexed by `scan_memories` — bare markdown
/// files without valid frontmatter are not touched. Protected memories that
/// would have been rewritten are skipped and reported; the user must
/// unprotect them before the cascade can fix their links.
fn apply_id_rename_cascade(
    app: &AppHandle,
    state: &State<AppState>,
    old_id: &str,
    new_id: &str,
) -> Result<CascadeRewriteOutcome, String> {
    let mut outcome = CascadeRewriteOutcome {
        old_id: old_id.to_string(),
        new_id: new_id.to_string(),
        rewrite_count: 0,
        affected_ids: Vec::new(),
        skipped_protected_ids: Vec::new(),
    };

    if old_id == new_id {
        return Ok(outcome);
    }

    let root = state.get_root();
    let scanned = scan_memories(&root);

    for (meta, path_str) in scanned {
        let file_path = PathBuf::from(&path_str);
        let mut memory = match read_memory(&root, &file_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let (new_l1, n1) = rewrite_wikilink_target(&memory.l1_content, old_id, new_id);
        let (new_l2, n2) = rewrite_wikilink_target(&memory.l2_content, old_id, new_id);
        let rewrites = n1 + n2;
        if rewrites == 0 {
            continue;
        }

        if meta.protected {
            outcome.skipped_protected_ids.push(meta.id.clone());
            continue;
        }

        memory.l1_content = new_l1;
        memory.l2_content = new_l2;
        memory.meta.modified = Utc::now();
        memory.meta.version = memory.meta.version.saturating_add(1);

        write_memory(&file_path, &memory)?;
        state.mark_recent_write(&file_path);

        {
            let mut index = state.memory_index.write().unwrap();
            if let Some(entry) = index.get_mut(&meta.id) {
                entry.0.modified = memory.meta.modified;
                entry.0.version = memory.meta.version;
            }
        }

        outcome.affected_ids.push(meta.id.clone());
        outcome.rewrite_count += rewrites;
    }

    if !outcome.is_empty() {
        let _ = app.emit("wikilinks-cascade", &outcome);
    }

    Ok(outcome)
}

fn should_regenerate_router(
    old_meta: &MemoryMeta,
    new_meta: &MemoryMeta,
    old_file_path: &PathBuf,
    new_file_path: &PathBuf,
) -> bool {
    old_file_path != new_file_path
        || old_meta.id != new_meta.id
        || old_meta.ontology != new_meta.ontology
        || old_meta.l0 != new_meta.l0
        || old_meta.importance != new_meta.importance
        || old_meta.tags != new_meta.tags
        || old_meta.triggers != new_meta.triggers
        || old_meta.related != new_meta.related
        || old_meta.requires != new_meta.requires
        || old_meta.optional != new_meta.optional
        || old_meta.output_format != new_meta.output_format
        || old_meta.status != new_meta.status
        || old_meta.protected != new_meta.protected
        || old_meta.derived_from != new_meta.derived_from
}

fn same_edit_signature(a: &MemoryMeta, b: &MemoryMeta) -> bool {
    a.id == b.id
        && a.ontology == b.ontology
        && a.l0 == b.l0
        && a.importance == b.importance
        && a.decay_rate == b.decay_rate
        && a.confidence == b.confidence
        && a.tags == b.tags
        && a.related == b.related
        && a.created == b.created
        && a.triggers == b.triggers
        && a.requires == b.requires
        && a.optional == b.optional
        && a.output_format == b.output_format
        && a.status == b.status
        && a.derived_from == b.derived_from
}

fn can_unlock_protected_memory(
    current: &Memory,
    requested_meta: &MemoryMeta,
    requested_l1: &str,
    requested_l2: &str,
) -> bool {
    current.meta.protected
        && !requested_meta.protected
        && current.l1_content == requested_l1
        && current.l2_content == requested_l2
        && same_edit_signature(&current.meta, requested_meta)
}

fn ensure_not_protected(meta: &MemoryMeta, action: &str) -> Result<(), String> {
    if meta.protected {
        Err(format!(
            "Memory '{}' is protected. Unprotect it before {}.",
            meta.id, action
        ))
    } else {
        Ok(())
    }
}

fn normalize_existing_dir(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve directory {}: {}", path.display(), e))
}

fn validate_memory_directory(root: &Path, dir: &Path) -> Result<PathBuf, String> {
    if !dir.exists() {
        return Err(format!("Destination does not exist: {}", dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!("Destination is not a directory: {}", dir.display()));
    }

    let normalized_root = normalize_existing_dir(root)?;
    let normalized_dir = normalize_existing_dir(dir)?;
    if !normalized_dir.starts_with(&normalized_root) {
        return Err("Destination must stay inside the workspace".to_string());
    }

    let paths = SystemPaths::new(&normalized_root);
    if normalized_dir == paths.sources_dir() {
        return Err("Cannot store memories inside sources/".to_string());
    }
    if normalized_dir == paths.inbox_dir() {
        return Err("Cannot store canonical memories inside inbox/".to_string());
    }
    if normalized_dir == paths.ai_dir() {
        return Err("Cannot store memories in the .ai/ system directory".to_string());
    }
    if normalized_dir.starts_with(paths.tasks_dir())
        || normalized_dir.starts_with(paths.journal_dir())
        || normalized_dir.starts_with(paths.scratch_dir())
    {
        return Err("Cannot store memories in system-managed .ai/ subdirectories".to_string());
    }

    Ok(normalized_dir)
}

/// List all memory metadata (L0 level).
#[tauri::command]
pub fn list_memories(
    filter: Option<MemoryFilter>,
    state: State<AppState>,
) -> Result<Vec<MemoryMeta>, String> {
    let root = state.get_root();
    let all = scan_memories(&root);

    // Update the in-memory index from this scan (single scan, reused below)
    let mut index = state.memory_index.write().unwrap();
    index.clear();
    for (meta, path) in &all {
        index.insert(meta.id.clone(), (meta.clone(), path.clone()));
    }
    drop(index);

    let metas: Vec<MemoryMeta> = all
        .into_iter()
        .map(|(meta, _path)| meta)
        .filter(|m| {
            if let Some(ref f) = filter {
                if let Some(ref ontology) = f.ontology {
                    if &m.ontology != ontology {
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

    Ok(metas)
}

/// Get a full memory with L1+L2 content.
/// Auto-increments access_count and updates last_access on every read.
#[tauri::command]
pub fn get_memory(id: String, state: State<AppState>) -> Result<Memory, String> {
    let root = state.get_root();
    let index = state.memory_index.read().unwrap();
    let (meta, path) = index
        .get(&id)
        .ok_or_else(|| format!("Memory not found: {}", id))?;

    let mut memory = read_memory(&root, std::path::Path::new(path))?;
    let timestamp = Utc::now();

    // Update runtime access tracking without touching canonical frontmatter
    record_access(&root, &id, timestamp)?;
    memory.meta.access_count = meta.access_count.saturating_add(1);
    memory.meta.last_access = timestamp;

    // Update in-memory index
    drop(index);
    let mut index = state.memory_index.write().unwrap();
    if let Some(entry) = index.get_mut(&id) {
        entry.0.access_count = memory.meta.access_count;
        entry.0.last_access = memory.meta.last_access;
    }

    Ok(memory)
}

/// Create a new memory file. Kept for compatibility with older flows.
/// Legacy callers now default to the workspace root so canonical memories are
/// created in a scannable location instead of the transient inbox surface.
#[tauri::command]
pub fn create_memory(
    input: CreateMemoryInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let root = state.get_root();
    create_memory_internal(input, root, app, state)
}

/// Create a new memory file inside a specific directory.
#[tauri::command]
pub fn create_memory_at_path(
    input: CreateMemoryInput,
    parent_dir: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<Memory, String> {
    let root = state.get_root();
    let parent_dir = validate_memory_directory(&root, Path::new(&parent_dir))?;
    create_memory_internal(input, parent_dir, app, state)
}

/// Save/update an existing memory. Normalizes `[[wikilinks]]` in L1/L2 to
/// canonical `[[id]]` form before writing; returns warnings for unresolved
/// or ambiguous links without blocking the save.
#[tauri::command]
pub fn save_memory(
    input: SaveMemoryInput,
    app: AppHandle,
    state: State<AppState>,
) -> Result<SaveMemoryResult, String> {
    let root = state.get_root();
    let index = state.memory_index.read().unwrap();
    let (old_meta, path) = index
        .get(&input.id)
        .ok_or_else(|| format!("Memory not found: {}", input.id))?;
    let old_meta = old_meta.clone();
    let old_file_path = PathBuf::from(path.clone());
    if input.meta.id.trim().is_empty() {
        return Err("Memory id cannot be empty".to_string());
    }
    if input.meta.id != input.id && index.contains_key(&input.meta.id) {
        return Err(format!("Memory already exists: {}", input.meta.id));
    }
    // Snapshot every canonical meta for wikilink resolution before releasing
    // the read lock.
    let memories_snapshot: Vec<MemoryMeta> =
        index.values().map(|(meta, _)| meta.clone()).collect();
    drop(index);

    let (normalized_l1, normalized_l2, wikilink_warnings) = normalize_memory_bodies(
        &input.l1_content,
        &input.l2_content,
        &memories_snapshot,
        &input.id,
    );

    if old_meta.protected {
        let current = read_memory(&root, &old_file_path)?;
        if !can_unlock_protected_memory(&current, &input.meta, &normalized_l1, &normalized_l2) {
            return Err(format!(
                "Memory '{}' is protected. Unprotect it first, then retry the edit.",
                old_meta.id
            ));
        }
    }

    let mut meta = input.meta;
    meta.modified = Utc::now();
    meta.version += 1;
    meta.id = meta.id.trim().to_string();

    // Zero Gravity: file stays in its current location regardless of type change.
    // Only the frontmatter type field changes.
    let target_parent = old_file_path
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.clone());
    let target_file_path = target_parent.join(format!("{}.md", meta.id));
    if target_file_path.exists() && target_file_path != old_file_path {
        return Err(format!(
            "A memory file already exists at {}",
            target_file_path.display()
        ));
    }

    enrich_memory_meta(&mut meta, &target_file_path, &root);

    let memory = Memory {
        meta,
        l1_content: normalized_l1,
        l2_content: normalized_l2,
        raw_content: String::new(),
        file_path: target_file_path.to_string_lossy().to_string(),
    };

    write_memory(&target_file_path, &memory)?;
    state.mark_recent_write(&target_file_path);
    if target_file_path != old_file_path && old_file_path.exists() {
        fs::remove_file(&old_file_path).map_err(|e| {
            format!(
                "Failed to move memory file {}: {}",
                old_file_path.display(),
                e
            )
        })?;
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

    let cascade = if input.id != memory.meta.id {
        let outcome = apply_id_rename_cascade(&app, &state, &input.id, &memory.meta.id)?;
        if outcome.is_empty() {
            None
        } else {
            Some(outcome)
        }
    } else {
        None
    };

    if should_regenerate_router(&old_meta, &memory.meta, &old_file_path, &target_file_path) {
        crate::commands::router::regenerate_router_internal(&app, &state)?;
    }

    Ok(SaveMemoryResult {
        memory,
        wikilink_warnings,
        cascade,
    })
}

/// Delete a memory file.
#[tauri::command]
pub fn delete_memory(id: String, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let index = state.memory_index.read().unwrap();
    let (meta, path) = index
        .get(&id)
        .ok_or_else(|| format!("Memory not found: {}", id))?;
    ensure_not_protected(meta, "deleting it")?;
    let path = path.clone();
    drop(index);

    let mut index = state.memory_index.write().unwrap();
    index.remove(&id);
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

    let root = state.get_root();
    let mut memory = read_memory(&root, &old_path)?;
    ensure_not_protected(&memory.meta, "renaming it")?;
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
        return Err(format!(
            "A memory file already exists at {}",
            new_path.display()
        ));
    }

    memory.meta.id = trimmed_id.to_string();
    memory.meta.modified = Utc::now();
    memory.meta.version += 1;
    memory.file_path = new_path.to_string_lossy().to_string();
    enrich_memory_meta(&mut memory.meta, &new_path, &root);

    write_memory(&new_path, &memory)?;
    state.mark_recent_write(&new_path);
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

    if old_id != memory.meta.id {
        apply_id_rename_cascade(&app, &state, &old_id, &memory.meta.id)?;
    }

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

    let root = state.get_root();
    let source = read_memory(&root, &source_path)?;
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
        return Err(format!(
            "A memory file already exists at {}",
            target_path.display()
        ));
    }

    let now = Utc::now();
    let mut memory = Memory {
        meta: MemoryMeta {
            id: trimmed_id.to_string(),
            ontology: source.meta.ontology,
            l0: source.meta.l0,
            importance: source.meta.importance,
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
            status: source.meta.status,
            protected: source.meta.protected,
            derived_from: source.meta.derived_from,
            folder_category: source.meta.folder_category,
            system_role: source.meta.system_role,
        },
        l1_content: source.l1_content,
        l2_content: source.l2_content,
        raw_content: String::new(),
        file_path: target_path.to_string_lossy().to_string(),
    };
    enrich_memory_meta(&mut memory.meta, &target_path, &root);

    write_memory(&target_path, &memory)?;
    state.mark_recent_write(&target_path);

    let mut index = state.memory_index.write().unwrap();
    index.insert(
        memory.meta.id.clone(),
        (
            memory.meta.clone(),
            target_path.to_string_lossy().to_string(),
        ),
    );
    drop(index);

    let _ = app.emit("memory-changed", &memory.meta.id);
    crate::commands::router::regenerate_router_internal(&app, &state)?;

    Ok(memory)
}

/// Move a memory file into another workspace folder.
/// Zero Gravity: the memory type is preserved — only the physical location changes.
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
    let root = state.get_root();
    let destination_dir = validate_memory_directory(&root, &destination_dir)?;

    let mut memory = read_memory(&root, &source_path)?;
    ensure_not_protected(&memory.meta, "moving it")?;
    let target_path = destination_dir.join(format!("{}.md", memory.meta.id));
    if target_path == source_path {
        return Ok(memory);
    }
    if target_path.exists() {
        return Err(format!(
            "A memory file already exists at {}",
            target_path.display()
        ));
    }

    let old_id = memory.meta.id.clone();
    memory.meta.modified = Utc::now();
    memory.meta.version += 1;
    memory.file_path = target_path.to_string_lossy().to_string();
    enrich_memory_meta(&mut memory.meta, &target_path, &root);

    write_memory(&target_path, &memory)?;
    state.mark_recent_write(&target_path);
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
        (
            memory.meta.clone(),
            target_path.to_string_lossy().to_string(),
        ),
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
    let mut meta = MemoryMeta {
        id: trimmed_id.to_string(),
        ontology: input.ontology,
        l0: input.l0,
        importance: input.importance,
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
        status: None,
        protected: false,
        derived_from: Vec::new(),
        folder_category: None,
        system_role: None,
    };
    enrich_memory_meta(&mut meta, &file_path, &state.get_root());

    let memory = Memory {
        meta,
        l1_content: input.l1_content,
        l2_content: input.l2_content,
        raw_content: String::new(),
        file_path: file_path.to_string_lossy().to_string(),
    };

    write_memory(&file_path, &memory)?;
    state.mark_recent_write(&file_path);

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
