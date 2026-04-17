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

/// Edge-kind weights mirroring `core::graph` so spreading activation respects
/// the same semantics used by community detection and the visualization layer.
/// `requires` (hard dep) pulls harder than `related`, which pulls harder than
/// `optional`. Kept in sync with `graph::WEIGHT_*`.
const SCORING_EDGE_REQUIRES: f64 = 1.0;
const SCORING_EDGE_RELATED: f64 = 0.7;
const SCORING_EDGE_OPTIONAL: f64 = 0.4;

/// Weight of the explicit edge from `meta` to `target_id`, based on which
/// outgoing list it appears in. Returns 0.0 if no such edge exists.
/// Priority follows the same order as `graph::collect_typed_edges`
/// (strongest kind wins when duplicated).
fn explicit_edge_weight(meta: &crate::core::types::MemoryMeta, target_id: &str) -> f64 {
    if meta.requires.iter().any(|x| x == target_id) {
        SCORING_EDGE_REQUIRES
    } else if meta.related.iter().any(|x| x == target_id) {
        SCORING_EDGE_RELATED
    } else if meta.optional.iter().any(|x| x == target_id) {
        SCORING_EDGE_OPTIONAL
    } else {
        0.0
    }
}

/// Graph proximity with two-level weighted spreading activation plus community
/// membership boost.
///
/// L1 (direct explicit link in selected_ids): +0.10 × edge_weight per match,
/// where edge_weight is 1.0 (requires), 0.7 (related), or 0.4 (optional).
/// L2 (connection-of-connection in selected_ids): +0.03 × edge_weight of the
/// second hop per match.
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

    // Level 1: direct links that appear in selected_ids, weighted by edge kind
    let l1_hits: Vec<(&String, f64)> = all_links
        .iter()
        .copied()
        .filter(|id| selected_ids.contains(id))
        .map(|id| (id, explicit_edge_weight(&memory.meta, id)))
        .collect();
    let l1_score: f64 = l1_hits.iter().map(|(_, w)| 0.10 * w).sum();
    let l1_ids: Vec<&String> = l1_hits.iter().map(|(id, _)| *id).collect();

    // Level 2: IDs referenced by L1 memories that also appear in selected_ids,
    // weighted by the kind of the second hop.
    let l2_score: f64 = all_memories
        .iter()
        .filter(|m| l1_ids.contains(&&m.meta.id))
        .flat_map(|m| {
            m.meta
                .explicit_links()
                .filter(|id| selected_ids.contains(*id) && !all_links.contains(id))
                .map(move |id| 0.03 * explicit_edge_weight(&m.meta, id))
        })
        .sum();

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
            if shares_community {
                0.08
            } else {
                0.0
            }
        }
        None => 0.0,
    };

    (l1_score + l2_score + community_bonus).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::{expand_query, graph_proximity_score};
    use crate::core::types::{Memory, MemoryMeta, MemoryOntology};
    use chrono::Utc;
    use std::collections::HashMap;

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

    fn make_mem(id: &str) -> Memory {
        Memory {
            meta: MemoryMeta {
                id: id.to_string(),
                ontology: MemoryOntology::Concept,
                l0: String::new(),
                importance: 0.5,
                decay_rate: 0.998,
                last_access: Utc::now(),
                access_count: 0,
                confidence: 0.9,
                tags: vec![],
                related: vec![],
                created: Utc::now(),
                modified: Utc::now(),
                version: 1,
                triggers: vec![],
                requires: vec![],
                optional: vec![],
                output_format: None,
                status: None,
                protected: false,
                derived_from: vec![],
                folder_category: None,
                system_role: None,
            },
            l1_content: String::new(),
            l2_content: String::new(),
            raw_content: String::new(),
            file_path: format!("{}.md", id),
        }
    }

    #[test]
    fn l1_bonus_scales_with_edge_kind_weight() {
        // mem-a --requires--> mem-b (weight 1.0) ⇒ L1 bonus = 0.10
        // mem-c --optional--> mem-b (weight 0.4) ⇒ L1 bonus = 0.04
        let mut a = make_mem("mem-a");
        a.meta.requires = vec!["mem-b".to_string()];
        let b = make_mem("mem-b");
        let mut c = make_mem("mem-c");
        c.meta.optional = vec!["mem-b".to_string()];

        let mems = vec![a.clone(), b.clone(), c.clone()];
        let selected = vec!["mem-b".to_string()];
        let empty: HashMap<String, u32> = HashMap::new();

        let sa = graph_proximity_score(&a, &mems, &selected, &empty);
        let sc = graph_proximity_score(&c, &mems, &selected, &empty);
        assert!((sa - 0.10).abs() < 1e-9, "requires should give 0.10, got {}", sa);
        assert!((sc - 0.04).abs() < 1e-9, "optional should give 0.04, got {}", sc);
    }

    #[test]
    fn related_edge_gives_intermediate_bonus() {
        // mem-a --related--> mem-b (weight 0.7) ⇒ L1 bonus = 0.07
        let mut a = make_mem("mem-a");
        a.meta.related = vec!["mem-b".to_string()];
        let b = make_mem("mem-b");
        let mems = vec![a.clone(), b];
        let selected = vec!["mem-b".to_string()];
        let empty: HashMap<String, u32> = HashMap::new();
        let s = graph_proximity_score(&a, &mems, &selected, &empty);
        assert!((s - 0.07).abs() < 1e-9, "related should give 0.07, got {}", s);
    }

    #[test]
    fn l2_bonus_uses_second_hop_weight() {
        // a --requires--> b --related--> c ; selected = {b, c}
        // L1(a→b, requires): 0.10 × 1.0 = 0.10
        // L2(b→c, related):  0.03 × 0.7 = 0.021
        let mut a = make_mem("mem-a");
        a.meta.requires = vec!["mem-b".to_string()];
        let mut b = make_mem("mem-b");
        b.meta.related = vec!["mem-c".to_string()];
        let c = make_mem("mem-c");
        let mems = vec![a.clone(), b, c];
        let selected = vec!["mem-b".to_string(), "mem-c".to_string()];
        let empty: HashMap<String, u32> = HashMap::new();
        let s = graph_proximity_score(&a, &mems, &selected, &empty);
        assert!((s - (0.10 + 0.021)).abs() < 1e-9, "got {}", s);
    }

    #[test]
    fn empty_selected_returns_zero() {
        let a = make_mem("mem-a");
        let empty: HashMap<String, u32> = HashMap::new();
        assert_eq!(graph_proximity_score(&a, &[a.clone()], &[], &empty), 0.0);
    }
}
