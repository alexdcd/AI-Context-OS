use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::core::search::{bm25_score, build_doc_freq, l0_keyword_score, tag_match_score};
use crate::core::types::{Memory, MemoryOntology, ScoreBreakdown, SystemRole};

// ─── Scoring weights per intent profile ───────────────────────────────────────

struct ScoringWeights {
    semantic: f64,
    bm25: f64,
    graph: f64,
    recency: f64,
    importance: f64,
    access_frequency: f64,
}

/// Detect intent from query and return appropriate weights (always sum to 1.0).
fn detect_intent_weights(query: &str) -> ScoringWeights {
    let q = query.to_lowercase();
    let is_debug = q.contains("error")
        || q.contains("falla")
        || q.contains("bug")
        || q.contains("panic")
        || q.contains("crash")
        || q.contains("exception");
    let is_brainstorm = q.contains("idea")
        || q.contains("propon")
        || q.contains("actua")
        || q.contains("brainstorm")
        || q.contains("suger");

    if is_debug {
        // Debug: BM25 + graph elevated for precise term & dependency matching
        ScoringWeights {
            semantic: 0.20,
            bm25: 0.30,
            graph: 0.30,
            recency: 0.10,
            importance: 0.05,
            access_frequency: 0.05,
        }
    } else if is_brainstorm {
        // Brainstorm: importance + recency elevated to surface relevant recent context
        ScoringWeights {
            semantic: 0.30,
            bm25: 0.05,
            graph: 0.05,
            recency: 0.25,
            importance: 0.30,
            access_frequency: 0.05,
        }
    } else {
        // Default: balanced hybrid
        ScoringWeights {
            semantic: 0.30,
            bm25: 0.15,
            graph: 0.10,
            recency: 0.15,
            importance: 0.20,
            access_frequency: 0.10,
        }
    }
}

// ─── Query expansion ──────────────────────────────────────────────────────────

/// Expand query with synonyms/related terms to increase lexical recall.
/// Result is used for BM25 and semantic matching; original query still drives intent detection.
fn expand_query(query: &str) -> String {
    let q = query.to_lowercase();
    let expansions: &[(&str, &str)] = &[
        ("bug", "bug error fix excepcion fallo"),
        ("error", "error bug fallo excepcion panic"),
        ("fix", "fix arreglar corregir bug error"),
        ("crash", "crash panic error fallo excepcion"),
        ("idea", "idea propuesta concepto brainstorm"),
        ("task", "task tarea pendiente accion action"),
        ("refactor", "refactor mejora limpieza codigo deuda"),
        ("deploy", "deploy despliegue release publicar"),
        ("test", "test prueba testing verificar"),
    ];
    let mut terms: Vec<String> = q.split_whitespace().map(|term| term.to_string()).collect();
    for (term, extra) in expansions {
        if q.contains(term) {
            for extra_term in extra.split_whitespace() {
                if !terms.iter().any(|existing| existing == extra_term) {
                    terms.push(extra_term.to_string());
                }
            }
        }
    }
    terms.join(" ")
}

// ─── Main scoring function ────────────────────────────────────────────────────

/// Compute the hybrid score for a memory given a query.
/// Uses dynamic intent-based weights and query expansion for better recall.
/// `community_map` maps memory_id → community_id for community-proximity boosting.
pub fn compute_score(
    query: &str,
    memory: &Memory,
    all_memories: &[Memory],
    selected_ids: &[String],
    community_map: &HashMap<String, u32>,
    now: DateTime<Utc>,
) -> ScoreBreakdown {
    let weights = detect_intent_weights(query);
    let expanded = expand_query(query);

    let semantic = semantic_score_free(&expanded, memory);
    let bm25 = compute_bm25(&expanded, memory, all_memories);
    let recency = recency_score(&memory.meta.last_access, now);
    let importance = memory.meta.importance;
    let access_frequency =
        access_frequency_score(memory.meta.access_count, max_access_count(all_memories));
    let graph_proximity = graph_proximity_score(memory, all_memories, selected_ids, community_map);

    let final_score = weights.semantic * semantic
        + weights.bm25 * bm25
        + weights.recency * recency
        + weights.importance * importance
        + weights.access_frequency * access_frequency
        + weights.graph * graph_proximity;

    ScoreBreakdown {
        semantic,
        bm25,
        recency,
        importance,
        access_frequency,
        graph_proximity,
        final_score,
    }
}

// ─── Component scoring functions ──────────────────────────────────────────────

/// Free-tier semantic approximation:
/// 40% tag matching + 35% L0 keyword overlap + 25% ontology bonus
fn semantic_score_free(query: &str, memory: &Memory) -> f64 {
    let tag_score = tag_match_score(query, &memory.meta.tags);
    let l0_score = l0_keyword_score(query, &memory.meta.l0);
    let ontology_bonus = ontology_bonus_score(query, memory);

    0.40 * tag_score + 0.35 * l0_score + 0.25 * ontology_bonus
}

/// Heuristic ontology bonus — if query seems to match the knowledge shape, boost it.
fn ontology_bonus_score(query: &str, memory: &Memory) -> f64 {
    let q = query.to_lowercase();
    let code_terms = [
        "code", "coding", "debug", "function", "api", "bug", "test", "programa", "código",
    ];
    let writing_terms = [
        "write",
        "post",
        "article",
        "blog",
        "linkedin",
        "newsletter",
        "escrib",
        "redact",
    ];
    let analysis_terms = [
        "analy",
        "research",
        "compet",
        "market",
        "investig",
        "tendencia",
    ];

    match memory.meta.system_role {
        Some(SystemRole::Skill) | Some(SystemRole::Rule) => {
            if code_terms.iter().any(|t| q.contains(t)) {
                return 0.8;
            }
            if writing_terms.iter().any(|t| q.contains(t)) {
                return 0.8;
            }
            0.3
        }
        None => match memory.meta.ontology {
            MemoryOntology::Entity => 0.4,
            MemoryOntology::Synthesis => {
                if analysis_terms.iter().any(|t| q.contains(t)) {
                    return 0.9;
                }
                0.2
            }
            MemoryOntology::Concept => 0.3,
            MemoryOntology::Source => 0.1,
            // Unknown ontologies (legacy / UI-generated types not in the 4
            // canonical variants) still participate in retrieval with a
            // neutral weight so useful content is not silently dropped.
            MemoryOntology::Unknown => 0.25,
        },
    }
}

/// BM25 score using all memories as corpus.
fn compute_bm25(query: &str, memory: &Memory, all_memories: &[Memory]) -> f64 {
    let documents: Vec<&str> = all_memories
        .iter()
        .map(|m| m.raw_content.as_str())
        .collect();

    if documents.is_empty() {
        return 0.0;
    }

    let avg_len = documents
        .iter()
        .map(|d| d.split_whitespace().count())
        .sum::<usize>() as f64
        / documents.len() as f64;
    let doc_freq = build_doc_freq(&documents);
    let content = format!(
        "{} {} {}",
        memory.meta.l0, memory.l1_content, memory.l2_content
    );

    let raw = bm25_score(query, &content, avg_len, documents.len(), &doc_freq);
    // Normalize to 0-1 range (cap at 10)
    (raw / 10.0).min(1.0)
}

/// Recency score: exp(-0.05 * days_since_last_access)
fn recency_score(last_access: &DateTime<Utc>, now: DateTime<Utc>) -> f64 {
    let days = (now - *last_access).num_hours() as f64 / 24.0;
    (-0.05 * days).exp()
}

/// Normalized access frequency: log(1 + count) / log(1 + max_count)
fn access_frequency_score(access_count: u32, max_count: u32) -> f64 {
    if max_count == 0 {
        return 0.0;
    }
    (1.0 + access_count as f64).ln() / (1.0 + max_count as f64).ln()
}

fn max_access_count(memories: &[Memory]) -> u32 {
    memories
        .iter()
        .map(|m| m.meta.access_count)
        .max()
        .unwrap_or(1)
}

/// Graph proximity with two-level spreading activation plus community membership boost.
///
/// L1 (direct connection via related/requires/optional in selected_ids): +0.10 per match.
/// L2 (connection-of-connection in selected_ids): +0.03 per match.
/// Community bonus: +0.08 if memory shares a community with any selected memory.
///
/// Result is capped at 1.0.
fn graph_proximity_score(
    memory: &Memory,
    all_memories: &[Memory],
    selected_ids: &[String],
    community_map: &HashMap<String, u32>,
) -> f64 {
    if selected_ids.is_empty() {
        return 0.0;
    }

    let all_links: Vec<&String> = memory.meta.explicit_links().collect();

    // Level 1: direct links that appear in selected_ids
    let l1_ids: Vec<&String> = all_links
        .iter()
        .copied()
        .filter(|id| selected_ids.contains(id))
        .collect();
    let l1_score = l1_ids.len() as f64 * 0.10;

    // Level 2: IDs referenced by L1 memories that also appear in selected_ids
    let l2_count = all_memories
        .iter()
        .filter(|m| l1_ids.contains(&&m.meta.id))
        .flat_map(|m| m.meta.explicit_links())
        .filter(|id| selected_ids.contains(id) && !all_links.contains(id))
        .count();
    let l2_score = l2_count as f64 * 0.03;

    // Community bonus: +0.08 if this memory is in the same topical cluster
    // as any of the top-scored selected memories (covers implicit tag-based proximity)
    let community_bonus = match community_map.get(&memory.meta.id) {
        Some(&mem_community) => {
            let shares_community = selected_ids.iter().any(|sid| {
                community_map
                    .get(sid)
                    .map(|&c| c == mem_community)
                    .unwrap_or(false)
            });
            if shares_community { 0.08 } else { 0.0 }
        }
        None => 0.0,
    };

    (l1_score + l2_score + community_bonus).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::expand_query;

    #[test]
    fn expand_query_only_uses_original_terms() {
        let expanded = expand_query("bug");
        assert_eq!(expanded, "bug error fix excepcion fallo");
    }

    #[test]
    fn expand_query_deduplicates_added_terms() {
        let expanded = expand_query("error bug");
        assert_eq!(expanded, "error bug fix excepcion fallo panic");
    }
}
