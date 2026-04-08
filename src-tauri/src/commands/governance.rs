use chrono::Utc;
use tauri::State;

use crate::core::governance::{
    check_scratch_ttl, detect_conflicts, find_decay_candidates, suggest_consolidation,
};
use crate::core::index::scan_memories;
use crate::core::jsonl::read_jsonl;
use crate::core::memory::read_memory;
use crate::core::types::{Conflict, ConsolidationSuggestion, DailyEntry, MemoryMeta};
use crate::state::AppState;

/// Get detected conflicts between memories.
#[tauri::command]
pub fn get_conflicts(state: State<AppState>) -> Result<Vec<Conflict>, String> {
    let root = state.get_root();
    let all_entries = scan_memories(&root);

    let mut memories = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(&root, std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    Ok(detect_conflicts(&memories))
}

/// Get memories that are candidates for archival due to decay.
#[tauri::command]
pub fn get_decay_candidates(state: State<AppState>) -> Result<Vec<MemoryMeta>, String> {
    let root = state.get_root();
    let config = state.config.read().unwrap();
    let all_entries = scan_memories(&root);
    let metas: Vec<MemoryMeta> = all_entries.into_iter().map(|(m, _)| m).collect();

    Ok(find_decay_candidates(
        &metas,
        Utc::now(),
        config.decay_threshold,
    ))
}

/// Get consolidation suggestions from daily logs.
#[tauri::command]
pub fn get_consolidation_suggestions(
    state: State<AppState>,
) -> Result<Vec<ConsolidationSuggestion>, String> {
    let root = state.get_root();
    let paths = crate::core::paths::SystemPaths::new(&root);
    let entries: Vec<DailyEntry> = read_jsonl(&paths.daily_log())?;
    Ok(suggest_consolidation(&entries))
}

/// Get scratch files that are past their TTL.
#[tauri::command]
pub fn get_scratch_candidates(state: State<AppState>) -> Result<Vec<String>, String> {
    let root = state.get_root();
    let paths = crate::core::paths::SystemPaths::new(&root);
    let config = state.config.read().unwrap();
    Ok(check_scratch_ttl(
        &paths.scratch_dir(),
        config.scratch_ttl_days,
    ))
}
