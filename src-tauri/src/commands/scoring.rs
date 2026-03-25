use chrono::Utc;
use tauri::State;

use crate::core::index::scan_memories;
use crate::core::levels::estimate_tokens;
use crate::core::memory::read_memory;
use crate::core::scoring::compute_score;
use crate::core::types::{LoadLevel, ScoredMemory};
use crate::state::AppState;

/// Simulate context loading for a query within a token budget.
#[tauri::command]
pub fn simulate_context(
    query: String,
    token_budget: u32,
    state: State<AppState>,
) -> Result<Vec<ScoredMemory>, String> {
    let root = state.get_root();
    let all_entries = scan_memories(&root);

    // Read full memories
    let mut memories = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    if memories.is_empty() {
        return Ok(Vec::new());
    }

    let now = Utc::now();
    let mut base_scored: Vec<(usize, crate::core::types::ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(&query, m, &memories, &[], now);
            (i, score)
        })
        .collect();
    base_scored.sort_by(|a, b| {
        b.1.final_score
            .partial_cmp(&a.1.final_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let selected_ids: Vec<String> = base_scored
        .iter()
        .take(5)
        .map(|(idx, _)| memories[*idx].meta.id.clone())
        .collect();

    // Score all memories
    let mut scored: Vec<(usize, crate::core::types::ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(&query, m, &memories, &selected_ids, now);
            (i, score)
        })
        .collect();

    // Sort by final_score descending
    scored.sort_by(|a, b| b.1.final_score.partial_cmp(&a.1.final_score).unwrap_or(std::cmp::Ordering::Equal));

    // Assign load levels greedily within token budget
    let mut remaining_budget = token_budget;
    let mut results = Vec::new();

    for (idx, score) in scored {
        let mem = &memories[idx];

        // L0 tokens (always counted — it's in the router)
        let l0_tokens = estimate_tokens(&mem.meta.l0);

        // Determine what level we can afford
        let l1_tokens = estimate_tokens(&mem.l1_content);
        let l2_tokens = estimate_tokens(&mem.l2_content);

        let (level, tokens) = if remaining_budget >= l0_tokens + l1_tokens + l2_tokens && score.final_score > 0.3 {
            (LoadLevel::L2, l0_tokens + l1_tokens + l2_tokens)
        } else if remaining_budget >= l0_tokens + l1_tokens && score.final_score > 0.15 {
            (LoadLevel::L1, l0_tokens + l1_tokens)
        } else if remaining_budget >= l0_tokens {
            (LoadLevel::L0, l0_tokens)
        } else {
            break; // Budget exhausted
        };

        remaining_budget = remaining_budget.saturating_sub(tokens);

        results.push(ScoredMemory {
            memory_id: mem.meta.id.clone(),
            l0: mem.meta.l0.clone(),
            memory_type: mem.meta.memory_type.clone(),
            load_level: level,
            score,
            token_estimate: tokens,
        });
    }

    Ok(results)
}
