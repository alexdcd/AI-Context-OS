use tauri::State;

use crate::core::engine::{assemble_chat_context_package, execute_context_query};
use crate::core::types::{ChatContextPayload, ScoredMemory};
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

#[tauri::command]
pub fn build_chat_context(
    query: String,
    token_budget: u32,
    state: State<AppState>,
) -> Result<ChatContextPayload, String> {
    let root = state.get_root();
    let config = state.config.read().unwrap().clone();

    let result = execute_context_query(&root, &query, token_budget, &config)?;
    Ok(ChatContextPayload {
        prompt_context: assemble_chat_context_package(&result),
        memory_ids: result
            .loaded
            .iter()
            .map(|memory| memory.memory_id.clone())
            .collect(),
    })
}
