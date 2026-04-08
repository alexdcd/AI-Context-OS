use tauri::State;

use crate::core::graph::{compute_god_nodes, to_graph_data};
use crate::core::index::scan_memories;
use crate::core::memory::read_memory;
use crate::core::types::{GodNode, GraphData};
use crate::state::AppState;

/// Get graph data for visualization (includes community assignments).
#[tauri::command]
pub fn get_graph_data(state: State<AppState>) -> Result<GraphData, String> {
    let root = state.get_root();
    let config = state.config.read().unwrap();
    let all_entries = scan_memories(&root);

    let mut memories = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(&root, std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    Ok(to_graph_data(&memories, config.decay_threshold))
}

/// Get god nodes: memories whose graph degree significantly exceeds their
/// engineer-assigned importance, surfacing potential under-valued knowledge.
#[tauri::command]
pub fn get_god_nodes(state: State<AppState>) -> Result<Vec<GodNode>, String> {
    let root = state.get_root();
    let all_entries = scan_memories(&root);

    let mut memories = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(&root, std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    Ok(compute_god_nodes(&memories))
}
