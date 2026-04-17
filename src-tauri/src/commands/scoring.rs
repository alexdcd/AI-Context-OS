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
    let prompt_context = assemble_chat_context_package(&result);
    let memory_ids: Vec<String> = result
        .loaded
        .iter()
        .map(|memory| memory.memory_id.clone())
        .collect();

    let top_score = result
        .scored_memories
        .first()
        .map(|m| m.score.final_score)
        .unwrap_or(0.0);
    log::info!(
        "build_chat_context query={:?} budget={} total_memories={} loaded={} unloaded={} top_score={:.3} tokens_used={} prompt_context_len={} empty={}",
        query,
        token_budget,
        result.total_memories,
        result.loaded.len(),
        result.unloaded.len(),
        top_score,
        result.tokens_used,
        prompt_context.len(),
        prompt_context.trim().is_empty(),
    );
    if prompt_context.trim().is_empty() {
        log::warn!(
            "build_chat_context returned EMPTY prompt_context (no memories passed the score/budget thresholds — the LLM will NOT receive any vault context). query={:?} total_memories={} top_score={:.3}",
            query,
            result.total_memories,
            top_score,
        );
    }

    Ok(ChatContextPayload {
        prompt_context,
        memory_ids,
    })
}
