use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;

use crate::core::graph::personalized_pagerank;
use crate::core::search::Bm25Corpus;
use crate::core::index::scan_memories;
use crate::core::levels::estimate_tokens;
use crate::core::memory::read_memory;
use crate::core::router::{build_router_manifest, render_mcp_prelude};
use crate::core::scoring::compute_score;
use crate::core::types::{Config, LoadLevel, Memory, ScoreBreakdown, ScoredMemory, SystemRole};

/// A memory that was loaded with its actual content.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LoadedMemory {
    pub memory_id: String,
    pub l0: String,
    pub ontology: crate::core::types::MemoryOntology,
    pub folder_category: Option<String>,
    pub system_role: Option<SystemRole>,
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
    pub ontology: crate::core::types::MemoryOntology,
    pub folder_category: Option<String>,
    pub system_role: Option<SystemRole>,
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

fn select_load_level(
    score: f64,
    top_score: f64,
    l2_loaded_count: usize,
    is_force_loaded: bool,
    remaining_budget: u32,
    l0_tokens: u32,
    l1_tokens: u32,
    l2_tokens: u32,
) -> Option<(LoadLevel, u32)> {
    let l2_threshold = top_score.mul_add(0.9, 0.0).max(0.3);
    let l1_threshold = top_score.mul_add(0.65, 0.0).max(0.15);

    if l2_loaded_count < 3
        && remaining_budget >= l0_tokens + l1_tokens + l2_tokens
        && score >= l2_threshold
    {
        return Some((LoadLevel::L2, l0_tokens + l1_tokens + l2_tokens));
    }

    if remaining_budget >= l0_tokens + l1_tokens && (score >= l1_threshold || is_force_loaded) {
        return Some((LoadLevel::L1, l0_tokens + l1_tokens));
    }

    if remaining_budget >= l0_tokens {
        return Some((LoadLevel::L0, l0_tokens));
    }

    None
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
    let manifest = build_router_manifest(&all_entries, root, config);
    let rules_content = render_mcp_prelude(&manifest);

    let mut memories: Vec<Memory> = Vec::new();
    for (meta, path) in &all_entries {
        if let Ok(mut mem) = read_memory(root, std::path::Path::new(path)) {
            mem.meta = meta.clone();
            memories.push(mem);
        }
    }

    if memories.is_empty() {
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

    // Precompute BM25 corpus stats once — shared across both passes
    let documents: Vec<&str> = memories.iter().map(|m| m.raw_content.as_str()).collect();
    let bm25_corpus = Bm25Corpus::from_documents(&documents);
    let empty_ppr = std::collections::HashMap::new();

    // First pass: score without graph context to identify seeds
    let mut base_scored: Vec<(usize, ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(query, m, &memories, &bm25_corpus, &empty_ppr, now);
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

    // Second pass: score with PPR graph proximity seeded from top-5
    let ppr_scores = personalized_pagerank(&memories, &selected_ids, 0.15);
    let mut scored: Vec<(usize, ScoreBreakdown)> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let score = compute_score(query, m, &memories, &bm25_corpus, &ppr_scores, now);
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
        if mem.meta.system_role != Some(SystemRole::Skill) || score.final_score <= 0.15 {
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
    let top_score = scored.first().map(|(_, s)| s.final_score).unwrap_or(0.0);

    // Greedy allocation within token budget
    let mut remaining_budget = token_budget;
    let mut scored_results = Vec::new();
    let mut loaded = Vec::new();
    let mut unloaded = Vec::new();
    let mut l2_loaded_count = 0usize;

    for (idx, score) in scored {
        let mem = &memories[idx];
        let is_force_loaded = force_load_ids.contains(&mem.meta.id);

        let l0_tokens = estimate_tokens(&mem.meta.l0);
        let l1_tokens = estimate_tokens(&mem.l1_content);
        let l2_tokens = estimate_tokens(&mem.l2_content);

        let Some((level, tokens)) = select_load_level(
            score.final_score,
            top_score,
            l2_loaded_count,
            is_force_loaded,
            remaining_budget,
            l0_tokens,
            l1_tokens,
            l2_tokens,
        ) else {
            // Budget exhausted — add to unloaded
            unloaded.push(UnloadedMemory {
                memory_id: mem.meta.id.clone(),
                l0: mem.meta.l0.clone(),
                ontology: mem.meta.ontology.clone(),
                folder_category: mem.meta.folder_category.clone(),
                system_role: mem.meta.system_role.clone(),
                score: score.final_score,
                reason: "budget_exhausted".to_string(),
            });
            continue;
        };

        remaining_budget = remaining_budget.saturating_sub(tokens);
        if level == LoadLevel::L2 {
            l2_loaded_count += 1;
        }

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
                ontology: mem.meta.ontology.clone(),
                folder_category: mem.meta.folder_category.clone(),
                system_role: mem.meta.system_role.clone(),
                score: score.final_score,
                reason: "below_threshold".to_string(),
            });
        } else if level != LoadLevel::L0 {
            loaded.push(LoadedMemory {
                memory_id: mem.meta.id.clone(),
                l0: mem.meta.l0.clone(),
                ontology: mem.meta.ontology.clone(),
                folder_category: mem.meta.folder_category.clone(),
                system_role: mem.meta.system_role.clone(),
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
            ontology: mem.meta.ontology.clone(),
            folder_category: mem.meta.folder_category.clone(),
            system_role: mem.meta.system_role.clone(),
            load_level: level,
            score,
            token_estimate: tokens,
        });
    }

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

pub fn assemble_chat_context_package(result: &ContextResult) -> String {
    if result.loaded.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity(result.tokens_used as usize * 4);
    out.push_str("# RELEVANT VAULT CONTEXT\n\n");

    for mem in &result.loaded {
        let level_tag = match mem.load_level {
            LoadLevel::L0 => "L0",
            LoadLevel::L1 => "L1",
            LoadLevel::L2 => "L2",
        };

        out.push_str(&format!(
            "## [{}] {} — {}\n",
            mem.memory_id, mem.l0, level_tag
        ));
        if mem.content.trim().is_empty() {
            out.push_str(&format!("Summary: {}\n\n", mem.l0));
        } else {
            out.push_str(&mem.content);
            out.push_str("\n\n");
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::core::types::{LoadLevel, MemoryOntology, ScoreBreakdown};

    fn sample_score(final_score: f64) -> ScoreBreakdown {
        ScoreBreakdown {
            semantic: final_score,
            bm25: 0.0,
            recency: 0.0,
            importance: 0.0,
            access_frequency: 0.0,
            graph_proximity: 0.0,
            final_score,
        }
    }

    #[test]
    fn select_load_level_limits_l2_to_top_cluster() {
        let high = select_load_level(0.82, 0.9, 0, false, 1_000, 10, 20, 30);
        let mid = select_load_level(0.61, 0.9, 1, false, 1_000, 10, 20, 30);

        assert!(matches!(high, Some((LoadLevel::L2, _))));
        assert!(matches!(mid, Some((LoadLevel::L1, _))));
    }

    #[test]
    fn select_load_level_caps_number_of_l2_memories() {
        let capped = select_load_level(0.88, 0.9, 3, false, 1_000, 10, 20, 30);

        assert!(matches!(capped, Some((LoadLevel::L1, _))));
    }

    #[test]
    fn assemble_chat_context_package_includes_loaded_memory_content() {
        let result = ContextResult {
            scored_memories: Vec::new(),
            loaded: vec![LoadedMemory {
                memory_id: "quien-soy-yo".to_string(),
                l0: "Yo soy alex dc".to_string(),
                ontology: MemoryOntology::Entity,
                folder_category: Some("about-me".to_string()),
                system_role: None,
                load_level: LoadLevel::L2,
                content: "Alex DC es indie hacker en Madrid.".to_string(),
                token_estimate: 42,
                score: sample_score(0.81),
                was_force_loaded: false,
            }],
            unloaded: Vec::new(),
            rules_content: "# MCP WORKSPACE RULES".to_string(),
            tokens_used: 42,
            tokens_budget: 100,
            total_memories: 1,
        };

        let rendered = assemble_chat_context_package(&result);

        assert!(rendered.contains("Yo soy alex dc"));
        assert!(rendered.contains("Alex DC es indie hacker en Madrid."));
        assert!(!rendered.contains("MCP WORKSPACE RULES"));
    }
}
