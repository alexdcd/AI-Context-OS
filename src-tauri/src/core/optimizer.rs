use crate::core::index::scan_memories;
use crate::core::levels::estimate_tokens;
use crate::core::memory::read_memory;
use crate::core::observability::{ObservabilityDb, OptimizationRecord};
use std::path::Path;

/// Run all optimization detectors and store results in the DB.
pub fn run_optimizations(db: &ObservabilityDb, root: &Path) -> Result<Vec<OptimizationRecord>, String> {
    // Clear old pending optimizations before fresh analysis
    db.clear_pending_optimizations()?;

    let all_entries = scan_memories(root);
    let mut suggestions = Vec::new();

    // Load all memories for analysis
    let mut memories = Vec::new();
    for (_meta, path) in &all_entries {
        if let Ok(mem) = read_memory(std::path::Path::new(path)) {
            memories.push(mem);
        }
    }

    // Get usage stats from DB
    let top_memories = db.get_top_memories(100, 30).unwrap_or_default();
    let unused = db.get_unused_memories(30).unwrap_or_default();

    // Detector 1: Compress large L1 content
    for mem in &memories {
        let l1_tokens = estimate_tokens(&mem.l1_content);
        if l1_tokens > 500 {
            suggestions.push(OptimizationRecord {
                id: 0,
                timestamp: String::new(),
                optimization_type: "compress_l1".to_string(),
                target_memory_id: Some(mem.meta.id.clone()),
                secondary_memory_id: None,
                description: format!(
                    "L1 de '{}' tiene ~{} tokens. Considera comprimir el resumen.",
                    mem.meta.l0, l1_tokens
                ),
                impact: if l1_tokens > 800 { "high".to_string() } else { "medium".to_string() },
                evidence: format!("{} tokens en L1", l1_tokens),
                estimated_token_saving: Some(l1_tokens.saturating_sub(300)),
                status: "pending".to_string(),
            });
        }
    }

    // Detector 2: Archive unused memories (30+ days without access)
    for unused_mem in &unused {
        if unused_mem.days_since_use > 30 {
            // Find the memory to check importance
            let importance = memories
                .iter()
                .find(|m| m.meta.id == unused_mem.memory_id)
                .map(|m| m.meta.importance)
                .unwrap_or(0.5);

            if importance < 0.7 {
                suggestions.push(OptimizationRecord {
                    id: 0,
                    timestamp: String::new(),
                    optimization_type: "archive_unused".to_string(),
                    target_memory_id: Some(unused_mem.memory_id.clone()),
                    secondary_memory_id: None,
                    description: format!(
                        "'{}' no se ha usado en {} dias (importancia: {:.1}). Considerar archivar.",
                        unused_mem.memory_id, unused_mem.days_since_use, importance
                    ),
                    impact: "medium".to_string(),
                    evidence: format!("{} dias sin uso", unused_mem.days_since_use),
                    estimated_token_saving: None,
                    status: "pending".to_string(),
                });
            }
        }
    }

    // Detector 3: Promote importance for frequently accessed low-importance memories
    for top in &top_memories {
        if top.times_served >= 5 {
            if let Some(mem) = memories.iter().find(|m| m.meta.id == top.memory_id) {
                if mem.meta.importance < 0.6 {
                    suggestions.push(OptimizationRecord {
                        id: 0,
                        timestamp: String::new(),
                        optimization_type: "promote_importance".to_string(),
                        target_memory_id: Some(mem.meta.id.clone()),
                        secondary_memory_id: None,
                        description: format!(
                            "'{}' se sirve frecuentemente ({} veces) pero tiene importancia baja ({:.1}). Subir importancia.",
                            mem.meta.l0, top.times_served, mem.meta.importance
                        ),
                        impact: "medium".to_string(),
                        evidence: format!("Servida {} veces, importancia {:.2}", top.times_served, mem.meta.importance),
                        estimated_token_saving: None,
                        status: "pending".to_string(),
                    });
                }
            }
        }
    }

    // Detector 4: Downgrade to L1 — memories always served as L2 when L1 might suffice
    for top in &top_memories {
        if top.typical_level == "L2" && top.times_served >= 3 {
            if let Some(mem) = memories.iter().find(|m| m.meta.id == top.memory_id) {
                let l2_tokens = estimate_tokens(&mem.l2_content);
                if l2_tokens > 200 {
                    suggestions.push(OptimizationRecord {
                        id: 0,
                        timestamp: String::new(),
                        optimization_type: "downgrade_to_l1".to_string(),
                        target_memory_id: Some(mem.meta.id.clone()),
                        secondary_memory_id: None,
                        description: format!(
                            "'{}' siempre se carga como L2 (~{} tokens extra). Revisa si L1 es suficiente.",
                            mem.meta.l0, l2_tokens
                        ),
                        impact: "low".to_string(),
                        evidence: format!("L2 siempre, {} tokens de detalle", l2_tokens),
                        estimated_token_saving: Some(l2_tokens),
                        status: "pending".to_string(),
                    });
                }
            }
        }
    }

    // Detector 5: Remove decayed memories
    for mem in &memories {
        let decay_score = mem.meta.importance * mem.meta.decay_rate.powf(mem.meta.access_count as f64);
        if decay_score < 0.05 && mem.meta.importance < 0.3 {
            suggestions.push(OptimizationRecord {
                id: 0,
                timestamp: String::new(),
                optimization_type: "remove_decayed".to_string(),
                target_memory_id: Some(mem.meta.id.clone()),
                secondary_memory_id: None,
                description: format!(
                    "'{}' tiene score de decay muy bajo ({:.3}). Considerar eliminar.",
                    mem.meta.l0, decay_score
                ),
                impact: "low".to_string(),
                evidence: format!("Decay score: {:.3}, importancia: {:.2}", decay_score, mem.meta.importance),
                estimated_token_saving: Some(estimate_tokens(&mem.l1_content) + estimate_tokens(&mem.l2_content)),
                status: "pending".to_string(),
            });
        }
    }

    // Detector 6: Merge candidates — high tag overlap + same type
    for (i, mem_a) in memories.iter().enumerate() {
        for mem_b in memories.iter().skip(i + 1) {
            if mem_a.meta.memory_type != mem_b.meta.memory_type {
                continue;
            }
            if mem_a.meta.tags.is_empty() || mem_b.meta.tags.is_empty() {
                continue;
            }
            let overlap = mem_a
                .meta
                .tags
                .iter()
                .filter(|t| mem_b.meta.tags.contains(t))
                .count();
            let min_tags = mem_a.meta.tags.len().min(mem_b.meta.tags.len());
            if min_tags > 0 && overlap as f64 / min_tags as f64 > 0.6 {
                suggestions.push(OptimizationRecord {
                    id: 0,
                    timestamp: String::new(),
                    optimization_type: "merge_candidates".to_string(),
                    target_memory_id: Some(mem_a.meta.id.clone()),
                    secondary_memory_id: Some(mem_b.meta.id.clone()),
                    description: format!(
                        "'{}' y '{}' comparten >60% de tags. Considerar consolidar.",
                        mem_a.meta.l0, mem_b.meta.l0
                    ),
                    impact: "low".to_string(),
                    evidence: format!("{}/{} tags compartidos", overlap, min_tags),
                    estimated_token_saving: None,
                    status: "pending".to_string(),
                });
            }
        }
    }

    // Detector 7: Nudge threshold — memories frequently near-threshold but not loaded
    // This requires checking memories_not_loaded with high scores
    let stats = db.get_stats(7).unwrap_or_default();
    if stats.requests_this_week > 0 {
        // Check recent not-loaded memories with high scores
        let recent = db.get_recent_requests(10).unwrap_or_default();
        let mut near_threshold_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for req in &recent {
            if let Ok(not_loaded) = db.get_not_loaded_for_request(req.id) {
                for nl in &not_loaded {
                    if nl.final_score > 0.12 && nl.reason == "below_threshold" {
                        *near_threshold_counts.entry(nl.memory_id.clone()).or_insert(0) += 1;
                    }
                }
            }
        }
        for (mem_id, count) in &near_threshold_counts {
            if *count >= 3 {
                suggestions.push(OptimizationRecord {
                    id: 0,
                    timestamp: String::new(),
                    optimization_type: "nudge_threshold".to_string(),
                    target_memory_id: Some(mem_id.clone()),
                    secondary_memory_id: None,
                    description: format!(
                        "'{}' estuvo cerca del umbral {} veces en las ultimas 10 peticiones. Subir importancia.",
                        mem_id, count
                    ),
                    impact: "medium".to_string(),
                    evidence: format!("Near-threshold {} veces", count),
                    estimated_token_saving: None,
                    status: "pending".to_string(),
                });
            }
        }
    }

    // Store all suggestions in DB
    for opt in &suggestions {
        let _ = db.insert_optimization(opt);
    }

    Ok(suggestions)
}

impl Default for ObservabilityStats {
    fn default() -> Self {
        Self {
            requests_this_week: 0,
            requests_prev_week: 0,
            tokens_served_total: 0,
            tokens_avg_per_request: 0,
            active_memories: 0,
            total_memories: 0,
            efficiency_percent: 0.0,
            force_rate_percent: 0.0,
        }
    }
}

use crate::core::observability::ObservabilityStats;
