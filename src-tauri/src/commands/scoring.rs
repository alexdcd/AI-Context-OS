use tauri::State;

use crate::core::engine::execute_context_query;
use crate::core::types::ScoredMemory;
use crate::state::AppState;

/// Simulate context loading for a query within a token budget.
#[tauri::command]
pub fn simulate_context(
    query: String,
    token_budget: u32,
    state: State<AppState>,
) -> Result<Vec<ScoredMemory>, String> {
    let root = state.get_root();
    let config = state.config.read().unwrap().clone();

    let result = execute_context_query(&root, &query, token_budget, &config)?;
    Ok(result.scored_memories)
}
