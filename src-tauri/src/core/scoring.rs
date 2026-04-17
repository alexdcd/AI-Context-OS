use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use crate::core::search::{bm25_score, tokenize, Bm25Corpus, l0_keyword_score, tag_match_score};
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

/// Intent vocabularies. Matched at stem level via `tokenize`, so every listed
/// surface form covers all its morphological variants (plural, conjugations,
/// gender) in both Spanish and English without needing them spelled out.
const DEBUG_VOCAB: &str = "error errores fallo fallar falla bug panic crash \
    exception excepcion romper roto arreglar corregir debug depurar stacktrace";
const BRAINSTORM_VOCAB: &str = "idea ideas proponer propuesta sugerir sugerencia \
    brainstorm lluvia actuar accion concepto explorar";

fn stems_of(text: &str) -> HashSet<String> {
    tokenize(text).into_iter().collect()
}

/// Detect intent from query and return appropriate weights (always sum to 1.0).
fn detect_intent_weights(query: &str) -> ScoringWeights {
    let query_stems = stems_of(query);
    let debug_stems = stems_of(DEBUG_VOCAB);
    let brainstorm_stems = stems_of(BRAINSTORM_VOCAB);

    let is_debug = query_stems.iter().any(|t| debug_stems.contains(t));
    let is_brainstorm = query_stems.iter().any(|t| brainstorm_stems.contains(t));

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

/// Synonym clusters. Matching happens at stem level via `tokenize`, so a single
/// entry like "deploy" covers "deploying", and "desplegar" covers "desplegamos",
/// "despliegue", etc. If any query token stem intersects a cluster, the whole
/// cluster is appended to the expanded query.
const EXPANSION_CLUSTERS: &[&str] = &[
    "bug bugs error errores fallo fallar excepcion excepciones panic crash",
    "arreglar corregir fix fixing solucionar reparar",
    "idea ideas propuesta proponer concepto brainstorm sugerencia sugerir",
    "task tarea pendiente accion action todo",
    "refactor refactoring mejora limpieza codigo deuda",
    "deploy deployment desplegar despliegue release publicar lanzar",
    "test tests prueba pruebas testing verificar validar",
];

/// Expand query with synonyms/related terms to increase lexical recall.
/// Result is used for BM25 and semantic matching; original query still drives intent detection.
fn expand_query(query: &str) -> String {
    let query_stems = stems_of(query);
    let mut extras: Vec<&str> = Vec::new();
    for cluster in EXPANSION_CLUSTERS {
        let cluster_stems = stems_of(cluster);
        if query_stems.iter().any(|t| cluster_stems.contains(t)) {
            extras.push(cluster);
        }
    }
    if extras.is_empty() {
        query.to_lowercase()
    } else {
        format!("{} {}", query.to_lowercase(), extras.join(" "))
    }
}

// ─── Main scoring function ────────────────────────────────────────────────────

/// Compute the hybrid score for a memory given a query.
/// Uses dynamic intent-based weights and query expansion for better recall.
/// `bm25_corpus` is precomputed once per query; `ppr_scores` is a precomputed
/// Personalized PageRank map (memory_id → score).
pub fn compute_score(
    query: &str,
    memory: &Memory,
    all_memories: &[Memory],
    bm25_corpus: &Bm25Corpus,
    ppr_scores: &HashMap<String, f64>,
    now: DateTime<Utc>,
) -> ScoreBreakdown {
    let weights = detect_intent_weights(query);
    let expanded = expand_query(query);

    let semantic = semantic_score_free(&expanded, memory);
    let bm25 = compute_bm25(&expanded, memory, bm25_corpus);
    let recency = recency_score(&memory.meta.last_access, now);
    let importance = memory.meta.importance;
    let access_frequency =
        access_frequency_score(memory.meta.access_count, max_access_count(all_memories));
    let graph_proximity = ppr_scores
        .get(&memory.meta.id)
        .copied()
        .unwrap_or(0.0)
        .min(1.0);
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

/// BM25 score for a memory against a precomputed corpus.
fn compute_bm25(query: &str, memory: &Memory, corpus: &Bm25Corpus) -> f64 {
    if corpus.total_docs == 0 {
        return 0.0;
    }
    let content = format!(
        "{} {} {}",
        memory.meta.l0, memory.l1_content, memory.l2_content
    );
    let raw = bm25_score(
        query,
        &content,
        corpus.avg_doc_len,
        corpus.total_docs,
        &corpus.doc_freq,
    );
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


#[cfg(test)]
mod tests {
    use super::{compute_score, expand_query, semantic_score_free};
    use crate::core::search::Bm25Corpus;
    use crate::core::types::{Memory, MemoryMeta, MemoryOntology};
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_mem(id: &str, l0: &str, tags: Vec<&str>) -> Memory {
        Memory {
            meta: MemoryMeta {
                id: id.to_string(),
                ontology: MemoryOntology::Concept,
                l0: l0.to_string(),
                importance: 0.5,
                decay_rate: 0.998,
                last_access: Utc::now(),
                access_count: 0,
                confidence: 0.9,
                tags: tags.into_iter().map(|s| s.to_string()).collect(),
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
    fn expand_query_adds_matching_cluster_terms() {
        let expanded = expand_query("bug");
        assert_eq!(
            expanded,
            "bug bug bugs error errores fallo fallar excepcion excepciones panic crash"
        );
    }

    #[test]
    fn expand_query_appends_each_cluster_once() {
        let expanded = expand_query("error bug");
        assert_eq!(
            expanded,
            "error bug bug bugs error errores fallo fallar excepcion excepciones panic crash"
        );
    }

    #[test]
    fn compute_score_semantic_uses_original_query_not_expanded_query() {
        let memory = make_mem("mem-a", "bug", vec!["bug"]);
        let memories = vec![memory.clone()];
        let score = compute_score(
            "bug",
            &memory,
            &memories,
            &Bm25Corpus::empty(),
            &HashMap::new(),
            Utc::now(),
        );

        assert_eq!(score.semantic, semantic_score_free("bug", &memory));
    }
}
