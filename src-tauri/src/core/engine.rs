use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;

use crate::core::index::scan_memories;
use crate::core::levels::estimate_tokens;
use crate::core::memory::read_memory;
use crate::core::router::generate_claude_md;
use crate::core::scoring::compute_score;
use crate::core::types::{Config, LoadLevel, Memory, MemoryType, ScoreBreakdown, ScoredMemory};

/// A memory that was loaded with its actual content.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LoadedMemory {
    pub memory_id: String,
    pub l0: String,
    pub memory_type: MemoryType,
    pub load_level: LoadLevel,
    pub content: String,
    pub token_estimate: u32,
    pub score: ScoreBreakdown,
    pub was_force_loaded: bool,
}

/// A memory that was considered but not loaded.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UnloadedMemory {
    pub memory_id: String,
    pub l0: String,
    pub memory_type: MemoryType,
    pub score: f64,
    pub reason: String,
}

/// Complete result of a context query execution.
#[derive(Debug, Clone)]
pub struct ContextResult {
    pub scored_memories: Vec<ScoredMemory>,
    pub loaded: Vec<LoadedMemory>,
    pub unloaded: Vec<UnloadedMemory>,
    pub rules_content: String,
    pub tokens_used: u32,
    pub tokens_budget: u32,
    pub total_memories: u32,
}

/// Execute a context query: score all memories, select the best ones within
/// the token budget, and return both the scored list and actual content.
///
/// This is the shared engine used by both the Tauri `simulate_context` command
/// and the MCP `get_context` tool.
pub fn execute_context_query(
    root: &Path,
    query: &str,
    token_budget: u32,
    config: &Config,
) -> Result<ContextResult, String> {
    let all_entries = scan_memories(root);
    let total_memories = all_entries.len() as u32;

    let mut memories: Vec<Memory> = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    if memories.is_empty() {
        // Generate rules even with no memories
        let rules_content = generate_claude_md(&[], config);
        return Ok(ContextResult {
            scored_memories: Vec::new(),
            loaded: Vec::new(),
            unloaded: Vec::new(),
            rules_content,
            tokens_used: 0,
            tokens_budget: token_budget,
            total_memories: 0,
        });
    }

    let now = Utc::now();

    // First pass: score without graph context to identify top 5
    let mut base_scored: Vec<(usize, ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(query, m, &memories, &[], now);
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

    // Second pass: score with graph proximity
    let mut scored: Vec<(usize, ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(query, m, &memories, &selected_ids, now);
            (i, score)
        })
        .collect();
    scored.sort_by(|a, b| {
        b.1.final_score
            .partial_cmp(&a.1.final_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Collect skill dependency IDs
    let mut force_load_ids: HashSet<String> = HashSet::new();
    let mut boost_ids: HashSet<String> = HashSet::new();
    for (idx, score) in scored.iter().take(5) {
        let mem = &memories[*idx];
        if mem.meta.memory_type != MemoryType::Skill || score.final_score <= 0.15 {
            continue;
        }

        for req_id in &mem.meta.requires {
            force_load_ids.insert(req_id.clone());
        }
        for opt_id in &mem.meta.optional {
            boost_ids.insert(opt_id.clone());
        }
    }

    // Apply optional boost
    let mut scored: Vec<(usize, ScoreBreakdown)> = scored
        .into_iter()
        .map(|(idx, mut s)| {
            if boost_ids.contains(&memories[idx].meta.id) {
                s.final_score = (s.final_score + 0.1).min(1.0);
            }
            (idx, s)
        })
        .collect();
    scored.sort_by(|a, b| {
        b.1.final_score
            .partial_cmp(&a.1.final_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Greedy allocation within token budget
    let mut remaining_budget = token_budget;
    let mut scored_results = Vec::new();
    let mut loaded = Vec::new();
    let mut unloaded = Vec::new();

    for (idx, score) in scored {
        let mem = &memories[idx];
        let is_force_loaded = force_load_ids.contains(&mem.meta.id);

        let l0_tokens = estimate_tokens(&mem.meta.l0);
        let l1_tokens = estimate_tokens(&mem.l1_content);
        let l2_tokens = estimate_tokens(&mem.l2_content);

        let (level, tokens) = if remaining_budget >= l0_tokens + l1_tokens + l2_tokens
            && score.final_score > 0.3
        {
            (LoadLevel::L2, l0_tokens + l1_tokens + l2_tokens)
        } else if remaining_budget >= l0_tokens + l1_tokens
            && (score.final_score > 0.15 || is_force_loaded)
        {
            (LoadLevel::L1, l0_tokens + l1_tokens)
        } else if remaining_budget >= l0_tokens {
            (LoadLevel::L0, l0_tokens)
        } else {
            // Budget exhausted — add to unloaded
            unloaded.push(UnloadedMemory {
                memory_id: mem.meta.id.clone(),
                l0: mem.meta.l0.clone(),
                memory_type: mem.meta.memory_type.clone(),
                score: score.final_score,
                reason: "budget_exhausted".to_string(),
            });
            continue;
        };

        remaining_budget = remaining_budget.saturating_sub(tokens);

        // Build content string based on level
        let content = match level {
            LoadLevel::L2 => {
                format!("{}\n\n{}", mem.l1_content, mem.l2_content)
            }
            LoadLevel::L1 => mem.l1_content.clone(),
            LoadLevel::L0 => String::new(),
        };

        // If L0 only, add to unloaded list (visible as available but not fully loaded)
        if level == LoadLevel::L0 && !is_force_loaded {
            unloaded.push(UnloadedMemory {
                memory_id: mem.meta.id.clone(),
                l0: mem.meta.l0.clone(),
                memory_type: mem.meta.memory_type.clone(),
                score: score.final_score,
                reason: "below_threshold".to_string(),
            });
        } else if level != LoadLevel::L0 {
            loaded.push(LoadedMemory {
                memory_id: mem.meta.id.clone(),
                l0: mem.meta.l0.clone(),
                memory_type: mem.meta.memory_type.clone(),
                load_level: level.clone(),
                content,
                token_estimate: tokens,
                score: score.clone(),
                was_force_loaded: is_force_loaded,
            });
        }

        scored_results.push(ScoredMemory {
            memory_id: mem.meta.id.clone(),
            l0: mem.meta.l0.clone(),
            memory_type: mem.meta.memory_type.clone(),
            load_level: level,
            score,
            token_estimate: tokens,
        });
    }

    // Generate rules content
    let all_metas: Vec<_> = memories.iter().map(|m| m.meta.clone()).collect();
    let rules_content = generate_claude_md(&all_metas, config);

    let tokens_used = token_budget - remaining_budget;

    Ok(ContextResult {
        scored_memories: scored_results,
        loaded,
        unloaded,
        rules_content,
        tokens_used,
        tokens_budget: token_budget,
        total_memories,
    })
}

/// Assemble the full context package as a markdown string for MCP clients.
pub fn assemble_context_package(result: &ContextResult) -> String {
    let mut out = String::with_capacity(result.tokens_used as usize * 5);

    // Rules at top (maximum attention positioning)
    out.push_str(&result.rules_content);
    out.push_str("\n---\n\n");

    // Loaded memories
    if !result.loaded.is_empty() {
        out.push_str("# CONTEXTO CARGADO PARA ESTA TAREA\n\n");
        for mem in &result.loaded {
            let level_tag = match mem.load_level {
                LoadLevel::L1 => "L1",
                LoadLevel::L2 => "L2",
                LoadLevel::L0 => "L0",
            };
            out.push_str(&format!(
                "## [{}] {} (score: {:.2})\n",
                level_tag, mem.memory_id, mem.score.final_score
            ));
            if !mem.content.is_empty() {
                out.push_str(&mem.content);
                out.push_str("\n\n");
            }
        }
    }

    // Unloaded memories (L0 references)
    if !result.unloaded.is_empty() {
        out.push_str("# MEMORIAS DISPONIBLES (no cargadas — pide si necesitas)\n\n");
        for mem in &result.unloaded {
            out.push_str(&format!(
                "- [{:.2}] {}: \"{}\"\n",
                mem.score, mem.memory_id, mem.l0
            ));
        }
        out.push('\n');
    }

    out
}
