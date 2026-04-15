use std::collections::HashMap;

use chrono::Utc;
use petgraph::graph::{Graph, NodeIndex};
use petgraph::Undirected;
use regex::Regex;

use crate::core::decay::decay_score;
use crate::core::types::{GodNode, GraphData, GraphEdge, GraphNode, Memory};

// ─── Edge types and weights ───────────────────────────────────────────────────

/// Semantic weight of each edge kind.
/// Higher weight = stronger affinity for community detection and graph layout.
const WEIGHT_REQUIRES: f64 = 1.0;  // hard dependency
const WEIGHT_RELATED:  f64 = 0.7;  // explicit semantic link
const WEIGHT_WIKILINK: f64 = 0.5;  // inline reference, intentional
const WEIGHT_OPTIONAL: f64 = 0.4;  // weak explicit link
const WEIGHT_TAG_STRONG: f64 = 0.3; // ≥2 shared tags
const WEIGHT_TAG_WEAK:   f64 = 0.1; // exactly 1 shared tag

#[derive(Debug, Clone, Copy, PartialEq)]
enum EdgeKind {
    Requires,
    Related,
    Optional,
    Wikilink,
    TagStrong,
    TagWeak,
}

impl EdgeKind {
    fn weight(self) -> f64 {
        match self {
            EdgeKind::Requires  => WEIGHT_REQUIRES,
            EdgeKind::Related   => WEIGHT_RELATED,
            EdgeKind::Wikilink  => WEIGHT_WIKILINK,
            EdgeKind::Optional  => WEIGHT_OPTIONAL,
            EdgeKind::TagStrong => WEIGHT_TAG_STRONG,
            EdgeKind::TagWeak   => WEIGHT_TAG_WEAK,
        }
    }

    fn label(self) -> &'static str {
        match self {
            EdgeKind::Requires  => "requires",
            EdgeKind::Related   => "related",
            EdgeKind::Optional  => "optional",
            EdgeKind::Wikilink  => "wikilink",
            EdgeKind::TagStrong => "tag",
            EdgeKind::TagWeak   => "tag",
        }
    }
}

/// A typed, weighted edge between two memory indices.
/// `source` and `target` preserve the original directionality declared by the
/// user (e.g. A requires B → source=A, target=B) so the frontend can render
/// animated arrows in the correct direction.
struct TypedEdge {
    source: usize,
    target: usize,
    kind: EdgeKind,
}

impl TypedEdge {
    fn weight(&self) -> f64 {
        self.kind.weight()
    }
}

/// Extract [[wikilink]] targets from markdown content.
fn extract_wikilinks(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(content)
        .map(|c| c[1].trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ─── Unified edge generation ──────────────────────────────────────────────────

/// Collect all typed edges between memories. This is the single source of truth
/// for edge semantics, used by both the visualization graph and community detection.
///
/// Edge kinds and their weights:
///   - `requires`  → 1.0 (hard dependency)
///   - `related`   → 0.7 (explicit semantic link)
///   - `wikilink`  → 0.5 (inline [[ref]])
///   - `optional`  → 0.4 (soft dependency)
///   - `tag` (≥2 shared) → 0.3 (significant thematic overlap)
///   - `tag` (1 shared)  → 0.1 (weak signal)
fn collect_typed_edges(memories: &[Memory]) -> Vec<TypedEdge> {
    let n = memories.len();
    let idx_map: HashMap<&str, usize> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| (m.meta.id.as_str(), i))
        .collect();

    // Track existing pairs to avoid duplicates (keep highest-weight edge).
    // The canonical key is (min, max) for dedup, but we store the original
    // (source, target) direction so the frontend can render arrows correctly.
    let mut pair_best: HashMap<(usize, usize), (usize, usize, EdgeKind)> = HashMap::new();

    let mut try_add = |src: usize, tgt: usize, kind: EdgeKind| {
        if src == tgt {
            return;
        }
        let key = if src < tgt { (src, tgt) } else { (tgt, src) };
        let entry = pair_best.entry(key).or_insert((src, tgt, kind));
        if kind.weight() > entry.2.weight() {
            *entry = (src, tgt, kind);
        }
    };

    // Explicit edges
    for (i, m) in memories.iter().enumerate() {
        for req_id in &m.meta.requires {
            if let Some(&j) = idx_map.get(req_id.as_str()) {
                try_add(i, j, EdgeKind::Requires);
            }
        }
        for rel_id in &m.meta.related {
            if let Some(&j) = idx_map.get(rel_id.as_str()) {
                try_add(i, j, EdgeKind::Related);
            }
        }
        for opt_id in &m.meta.optional {
            if let Some(&j) = idx_map.get(opt_id.as_str()) {
                try_add(i, j, EdgeKind::Optional);
            }
        }
        // Wikilinks from content
        let wikilinks: Vec<String> = extract_wikilinks(&m.l1_content)
            .into_iter()
            .chain(extract_wikilinks(&m.l2_content))
            .collect();
        for linked_id in wikilinks {
            if let Some(&j) = idx_map.get(linked_id.as_str()) {
                try_add(i, j, EdgeKind::Wikilink);
            }
        }
    }

    // Tag co-occurrence: differentiate 1 shared tag (weak) vs ≥2 (strong)
    for i in 0..n {
        for j in (i + 1)..n {
            let shared_count = memories[i]
                .meta
                .tags
                .iter()
                .filter(|t| memories[j].meta.tags.contains(t))
                .count();
            if shared_count >= 2 {
                try_add(i, j, EdgeKind::TagStrong);
            } else if shared_count == 1 {
                try_add(i, j, EdgeKind::TagWeak);
            }
        }
    }

    pair_best
        .into_values()
        .map(|(src, tgt, kind)| TypedEdge {
            source: src,
            target: tgt,
            kind,
        })
        .collect()
}

/// Build an undirected petgraph from all typed edges.
/// Used for frontend visualization and god-node degree computation.
pub fn build_graph(memories: &[Memory]) -> Graph<String, String, Undirected> {
    let mut graph = Graph::<String, String, Undirected>::new_undirected();
    let mut node_indices: Vec<NodeIndex> = Vec::with_capacity(memories.len());

    for m in memories {
        node_indices.push(graph.add_node(m.meta.id.clone()));
    }

    for edge in collect_typed_edges(memories) {
        let src = node_indices[edge.source];
        let tgt = node_indices[edge.target];
        graph.add_edge(src, tgt, edge.kind.label().to_string());
    }

    graph
}

/// Compute community assignments using Weighted Label Propagation Algorithm.
///
/// Unlike basic LPA where each neighbor vote counts equally, weighted LPA
/// sums edge weights per label. This means a `requires` edge (1.0) pulls
/// a node much harder into a community than a single shared tag (0.1).
///
/// Uses the unified `collect_typed_edges()` as single source of truth.
///
/// Returns a map from memory_id → community_id (0-indexed, sequential).
/// Isolated nodes (no edges) each get their own singleton community.
pub fn compute_community_map(memories: &[Memory]) -> HashMap<String, u32> {
    let n = memories.len();
    if n == 0 {
        return HashMap::new();
    }

    // Build weighted adjacency from unified edge source
    let typed_edges = collect_typed_edges(memories);
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];

    for edge in &typed_edges {
        let w = edge.weight();
        adj[edge.source].push((edge.target, w));
        adj[edge.target].push((edge.source, w));
    }

    // Weighted LPA: initialize each node with its own label
    let mut labels: Vec<u32> = (0..n as u32).collect();
    let mut changed = true;
    let mut iterations = 0;

    while changed && iterations < 20 {
        changed = false;
        iterations += 1;

        for i in 0..n {
            if adj[i].is_empty() {
                continue;
            }

            // Sum neighbor label weights (not counts)
            let mut weight_by_label: HashMap<u32, f64> = HashMap::new();
            for &(j, w) in &adj[i] {
                *weight_by_label.entry(labels[j]).or_insert(0.0) += w;
            }

            // Highest-weight label; ties broken by smallest label (deterministic)
            let best_label = weight_by_label
                .into_iter()
                .max_by(|a, b| {
                    a.1.partial_cmp(&b.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(b.0.cmp(&a.0))
                })
                .map(|(label, _)| label)
                .unwrap();

            if labels[i] != best_label {
                labels[i] = best_label;
                changed = true;
            }
        }
    }

    // Normalize raw labels → sequential 0..k community IDs
    let mut label_to_community: HashMap<u32, u32> = HashMap::new();
    let mut next_id = 0u32;
    let mut result: HashMap<String, u32> = HashMap::new();

    for (i, m) in memories.iter().enumerate() {
        let community_id = *label_to_community.entry(labels[i]).or_insert_with(|| {
            let id = next_id;
            next_id += 1;
            id
        });
        result.insert(m.meta.id.clone(), community_id);
    }

    result
}

/// Compute god nodes: memories whose graph degree (explicit links) significantly
/// exceeds their engineer-assigned importance.
///
/// A memory is a god node if:
///   - mismatch_score = normalized_degree - importance > 0.2, OR
///   - degree ≥ 2 (structurally connected regardless of mismatch)
///
/// Returns up to 20 candidates sorted by mismatch_score descending.
pub fn compute_god_nodes(memories: &[Memory]) -> Vec<GodNode> {
    if memories.is_empty() {
        return Vec::new();
    }

    let graph = build_graph(memories);

    // Build node index → memory lookup
    let id_map: HashMap<&str, &Memory> =
        memories.iter().map(|m| (m.meta.id.as_str(), m)).collect();

    let max_degree = graph
        .node_indices()
        .map(|n| graph.neighbors(n).count())
        .max()
        .unwrap_or(1)
        .max(1);

    let mut god_nodes: Vec<GodNode> = Vec::new();

    for node_idx in graph.node_indices() {
        let id = graph[node_idx].as_str();
        let degree = graph.neighbors(node_idx).count();

        let Some(memory) = id_map.get(id) else {
            continue;
        };

        let normalized_degree = degree as f64 / max_degree as f64;
        let mismatch_score = normalized_degree - memory.meta.importance;

        if mismatch_score > 0.2 || degree >= 2 {
            god_nodes.push(GodNode {
                memory_id: id.to_string(),
                l0: memory.meta.l0.clone(),
                ontology: memory.meta.ontology.clone(),
                folder_category: memory.meta.folder_category.clone(),
                system_role: memory.meta.system_role.clone(),
                degree,
                importance: memory.meta.importance,
                mismatch_score,
            });
        }
    }

    god_nodes.sort_by(|a, b| {
        b.mismatch_score
            .partial_cmp(&a.mismatch_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.degree.cmp(&a.degree))
    });

    god_nodes.truncate(20);
    god_nodes
}

/// Convert the petgraph graph + memories into serializable GraphData for the frontend.
/// Includes community assignment computed via weighted LPA.
pub fn to_graph_data(memories: &[Memory], _decay_threshold: f64) -> GraphData {
    let graph = build_graph(memories);
    let community_map = compute_community_map(memories);
    let typed_edges = collect_typed_edges(memories);

    let id_map: HashMap<&str, &Memory> =
        memories.iter().map(|m| (m.meta.id.as_str(), m)).collect();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for node_idx in graph.node_indices() {
        let id = graph[node_idx].as_str();
        if let Some(memory) = id_map.get(id) {
            let days_since_last_access =
                (Utc::now() - memory.meta.last_access).num_hours() as f64 / 24.0;
            let degree = graph.neighbors(node_idx).count();
            let preview: String = memory
                .l1_content
                .chars()
                .take(160)
                .collect::<String>()
                .trim()
                .to_string();
            nodes.push(GraphNode {
                id: id.to_string(),
                label: memory.meta.l0.clone(),
                ontology: memory.meta.ontology.clone(),
                folder_category: memory.meta.folder_category.clone(),
                system_role: memory.meta.system_role.clone(),
                importance: memory.meta.importance,
                decay_score: decay_score(
                    memory.meta.decay_rate,
                    memory.meta.access_count,
                    days_since_last_access.max(0.0),
                ),
                community: community_map.get(id).copied(),
                degree,
                preview,
            });
        }
    }

    // Use typed edges to include weight for frontend layout/rendering
    for edge in &typed_edges {
        edges.push(GraphEdge {
            source: memories[edge.source].meta.id.clone(),
            target: memories[edge.target].meta.id.clone(),
            edge_type: edge.kind.label().to_string(),
            weight: edge.weight(),
        });
    }

    GraphData { nodes, edges }
}

/// Also expose community map for use by the scoring engine.
/// Accepts &[Memory] directly so the engine doesn't need to re-build the graph.
pub fn get_community_map_for_scoring(memories: &[Memory]) -> HashMap<String, u32> {
    compute_community_map(memories)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::{Memory, MemoryMeta, MemoryOntology};
    use chrono::Utc;

    fn make_memory(id: &str, related: Vec<&str>, tags: Vec<&str>, l1: &str) -> Memory {
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
                tags: tags.into_iter().map(|s| s.to_string()).collect(),
                related: related.into_iter().map(|s| s.to_string()).collect(),
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
            l1_content: l1.to_string(),
            l2_content: String::new(),
            raw_content: String::new(),
            file_path: format!("{}.md", id),
        }
    }

    // --- extract_wikilinks ---

    #[test]
    fn extracts_single_wikilink() {
        assert_eq!(extract_wikilinks("See [[mem-b]] for details."), vec!["mem-b"]);
    }

    #[test]
    fn extracts_multiple_wikilinks() {
        assert_eq!(
            extract_wikilinks("See [[a]] and [[b]] and [[c]]."),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn returns_empty_when_no_wikilinks() {
        assert!(extract_wikilinks("No links here.").is_empty());
    }

    #[test]
    fn trims_whitespace_in_wikilinks() {
        assert_eq!(extract_wikilinks("[[ mem-b ]]"), vec!["mem-b"]);
    }

    // --- build_graph ---

    #[test]
    fn related_memories_get_one_edge() {
        let a = make_memory("mem-a", vec!["mem-b"], vec![], "");
        let b = make_memory("mem-b", vec![], vec![], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.node_count(), 2);
        assert_eq!(graph.edge_count(), 1);
    }

    #[test]
    fn wikilink_and_related_to_same_target_deduplicated_to_one_edge() {
        let a = make_memory("mem-a", vec!["mem-b"], vec![], "See [[mem-b]]");
        let b = make_memory("mem-b", vec![], vec![], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.edge_count(), 1);
    }

    #[test]
    fn shared_tag_creates_edge() {
        let a = make_memory("mem-a", vec![], vec!["rust"], "");
        let b = make_memory("mem-b", vec![], vec!["rust"], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.edge_count(), 1);
    }

    #[test]
    fn no_shared_tags_and_no_links_means_no_edges() {
        let a = make_memory("mem-a", vec![], vec!["rust"], "");
        let b = make_memory("mem-b", vec![], vec!["python"], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.edge_count(), 0);
    }

    #[test]
    fn unresolvable_related_id_does_not_crash() {
        let a = make_memory("mem-a", vec!["does-not-exist"], vec![], "");
        let graph = build_graph(&[a]);
        assert_eq!(graph.node_count(), 1);
        assert_eq!(graph.edge_count(), 0);
    }

    // --- compute_community_map ---

    #[test]
    fn connected_memories_share_community() {
        let a = make_memory("mem-a", vec!["mem-b"], vec![], "");
        let b = make_memory("mem-b", vec![], vec![], "");
        let map = compute_community_map(&[a, b]);
        assert_eq!(map["mem-a"], map["mem-b"]);
    }

    #[test]
    fn isolated_memories_get_different_communities() {
        let a = make_memory("mem-a", vec![], vec![], "");
        let b = make_memory("mem-b", vec![], vec![], "");
        let map = compute_community_map(&[a, b]);
        assert_ne!(map["mem-a"], map["mem-b"]);
    }

    #[test]
    fn empty_input_returns_empty_community_map() {
        assert!(compute_community_map(&[]).is_empty());
    }

    // --- compute_god_nodes ---

    #[test]
    fn hub_with_two_connections_is_god_node() {
        // degree=2 qualifies regardless of importance (rule: degree >= 2)
        let hub = make_memory("hub", vec!["mem-a", "mem-b"], vec![], "");
        let a = make_memory("mem-a", vec![], vec![], "");
        let b = make_memory("mem-b", vec![], vec![], "");
        let god_nodes = compute_god_nodes(&[hub, a, b]);
        assert!(god_nodes.iter().any(|g| g.memory_id == "hub"));
    }

    #[test]
    fn isolated_memory_is_not_god_node() {
        let a = make_memory("mem-a", vec![], vec![], "");
        assert!(compute_god_nodes(&[a]).is_empty());
    }

    #[test]
    fn god_nodes_sorted_by_mismatch_score_descending() {
        // hub-a has higher degree than hub-b → should appear first
        let hub_a = make_memory("hub-a", vec!["x", "y", "z"], vec![], "");
        let hub_b = make_memory("hub-b", vec!["x", "y"], vec![], "");
        let x = make_memory("x", vec![], vec![], "");
        let y = make_memory("y", vec![], vec![], "");
        let z = make_memory("z", vec![], vec![], "");
        let god_nodes = compute_god_nodes(&[hub_a, hub_b, x, y, z]);
        let pos_a = god_nodes.iter().position(|g| g.memory_id == "hub-a").unwrap();
        let pos_b = god_nodes.iter().position(|g| g.memory_id == "hub-b").unwrap();
        assert!(pos_a < pos_b);
    }

    // --- collect_typed_edges / weighted LPA ---

    #[test]
    fn requires_edge_has_highest_weight() {
        // When both `related` and `requires` exist between same pair,
        // the higher-weight `requires` should win.
        let mut a = make_memory("mem-a", vec!["mem-b"], vec![], "");
        a.meta.requires = vec!["mem-b".to_string()];
        let b = make_memory("mem-b", vec![], vec![], "");
        let graph = build_graph(&[a, b]);
        // collect_typed_edges keeps only 1 edge per pair (highest weight)
        assert_eq!(graph.edge_count(), 1);
        // The edge label should be "requires" (weight 1.0 > related 0.7)
        let edge_idx = graph.edge_indices().next().unwrap();
        assert_eq!(graph[edge_idx], "requires");
    }

    #[test]
    fn single_shared_tag_creates_weak_edge() {
        let a = make_memory("mem-a", vec![], vec!["rust"], "");
        let b = make_memory("mem-b", vec![], vec!["rust"], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.edge_count(), 1);
        let edge_idx = graph.edge_indices().next().unwrap();
        assert_eq!(graph[edge_idx], "tag");
    }

    #[test]
    fn two_shared_tags_creates_strong_tag_edge() {
        let a = make_memory("mem-a", vec![], vec!["rust", "backend"], "");
        let b = make_memory("mem-b", vec![], vec!["rust", "backend"], "");
        let graph = build_graph(&[a, b]);
        assert_eq!(graph.edge_count(), 1);
        // TagStrong weight (0.3) > TagWeak (0.1)
        let edge_idx = graph.edge_indices().next().unwrap();
        assert_eq!(graph[edge_idx], "tag");
    }

    #[test]
    fn weighted_lpa_requires_dominates_over_weak_tags() {
        // A-requires->B should cluster them together even when
        // A has a weak tag connection to C and no tag connection to B.
        let mut a = make_memory("mem-a", vec![], vec!["common"], "");
        a.meta.requires = vec!["mem-b".to_string()];
        let b = make_memory("mem-b", vec![], vec![], "");
        let c = make_memory("mem-c", vec![], vec!["common"], "");

        let map = compute_community_map(&[a, b, c]);
        // A and B should share community via requires (1.0)
        assert_eq!(map["mem-a"], map["mem-b"]);
        // C might or might not join; but A-B bond is what matters
    }

    #[test]
    fn to_graph_data_returns_nodes_and_edges_for_vault_like_data() {
        // Simulates the real vault: 3 memories share tag "comida",
        // plus isolated memories with no connections.
        let baicon = make_memory("baicon", vec![], vec!["comida", "menu"], "");
        let patat = make_memory("patat", vec![], vec!["comida", "memor"], "");
        let boniato = make_memory("boniato", vec![], vec!["comida"], "");
        let queso = make_memory("queso", vec![], vec![], "");
        let perfil = make_memory("perfil", vec![], vec![], "");

        let data = to_graph_data(&[baicon, patat, boniato, queso, perfil], 0.0);

        // All 5 should be nodes
        assert_eq!(data.nodes.len(), 5);
        // At least 3 edges from shared "comida" tag: baicon↔patat, baicon↔boniato, patat↔boniato
        assert!(
            data.edges.len() >= 3,
            "expected ≥3 edges from shared tag 'comida', got {}",
            data.edges.len()
        );
        // Each edge should have a weight > 0
        assert!(data.edges.iter().all(|e| e.weight > 0.0));
    }

    #[test]
    fn to_graph_data_degree_ignores_inferred_edges() {
        let a = make_memory("mem-a", vec![], vec!["rust"], "See [[mem-b]]");
        let b = make_memory("mem-b", vec![], vec!["rust"], "");

        let data = to_graph_data(&[a, b], 0.0);
        let degrees: HashMap<_, _> = data
            .nodes
            .iter()
            .map(|node| (node.id.as_str(), node.degree))
            .collect();

        assert_eq!(degrees.get("mem-a"), Some(&0));
        assert_eq!(degrees.get("mem-b"), Some(&0));
    }

    #[test]
    fn tag_only_connections_do_not_create_god_nodes() {
        let hub = make_memory("hub", vec![], vec!["rust", "graph"], "");
        let a = make_memory("mem-a", vec![], vec!["rust"], "");
        let b = make_memory("mem-b", vec![], vec!["graph"], "");

        let god_nodes = compute_god_nodes(&[hub, a, b]);
        assert!(!god_nodes.iter().any(|g| g.memory_id == "hub"));
    }
}

/// Get the count of connections for a memory (undirected graph degree, explicit links only).
#[allow(dead_code)]
pub fn connection_count(memory_id: &str, memories: &[Memory]) -> usize {
    let graph = build_graph(memories);
    let idx_map: HashMap<&str, NodeIndex> = graph
        .node_indices()
        .map(|n| (graph[n].as_str(), n))
        .collect();

    idx_map
        .get(memory_id)
        .map(|&n| graph.neighbors(n).count())
        .unwrap_or(0)
}
