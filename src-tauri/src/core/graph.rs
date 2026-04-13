use std::collections::HashMap;

use chrono::Utc;
use petgraph::graph::{Graph, NodeIndex};
use petgraph::Undirected;
use regex::Regex;

use crate::core::decay::decay_score;
use crate::core::types::{GodNode, GraphData, GraphEdge, GraphNode, Memory};

/// Extract [[wikilink]] targets from markdown content.
fn extract_wikilinks(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    re.captures_iter(content)
        .map(|c| c[1].trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Build an undirected graph from:
///   - Explicit relationships (related/requires/optional)
///   - Wikilinks [[id]] in l1_content / l2_content
///   - Tag co-occurrence (≥1 shared tag)
pub fn build_graph(memories: &[Memory]) -> Graph<String, String, Undirected> {
    let mut graph = Graph::<String, String, Undirected>::new_undirected();
    let mut id_to_node: HashMap<String, NodeIndex> = HashMap::new();

    for m in memories {
        let idx = graph.add_node(m.meta.id.clone());
        id_to_node.insert(m.meta.id.clone(), idx);
    }

    for m in memories {
        if let Some(&source) = id_to_node.get(&m.meta.id) {
            // Explicit: related
            for related_id in &m.meta.related {
                if let Some(&target) = id_to_node.get(related_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "related".to_string());
                    }
                }
            }
            // Explicit: requires
            for req_id in &m.meta.requires {
                if let Some(&target) = id_to_node.get(req_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "requires".to_string());
                    }
                }
            }
            // Explicit: optional
            for opt_id in &m.meta.optional {
                if let Some(&target) = id_to_node.get(opt_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "optional".to_string());
                    }
                }
            }
            // Wikilinks from content
            let wikilinks: Vec<String> = extract_wikilinks(&m.l1_content)
                .into_iter()
                .chain(extract_wikilinks(&m.l2_content))
                .collect();
            for linked_id in wikilinks {
                if let Some(&target) = id_to_node.get(&linked_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "wikilink".to_string());
                    }
                }
            }
        }
    }

    // Tag co-occurrence edges (≥1 shared tag)
    let mem_vec: Vec<&Memory> = memories.iter().collect();
    for i in 0..mem_vec.len() {
        for j in (i + 1)..mem_vec.len() {
            let shared = mem_vec[i]
                .meta
                .tags
                .iter()
                .any(|t| mem_vec[j].meta.tags.contains(t));
            if shared {
                if let (Some(&src), Some(&tgt)) = (
                    id_to_node.get(&mem_vec[i].meta.id),
                    id_to_node.get(&mem_vec[j].meta.id),
                ) {
                    if !graph.contains_edge(src, tgt) {
                        graph.add_edge(src, tgt, "tag".to_string());
                    }
                }
            }
        }
    }

    graph
}

/// Compute community assignments using Label Propagation Algorithm (LPA).
///
/// Edges include:
///   - Explicit links (related, requires, optional)
///   - Implicit tag co-occurrence: two memories sharing ≥2 tags
///
/// Returns a map from memory_id → community_id (0-indexed, sequential).
/// Isolated nodes (no edges) each get their own singleton community.
pub fn compute_community_map(memories: &[Memory]) -> HashMap<String, u32> {
    let n = memories.len();
    if n == 0 {
        return HashMap::new();
    }

    // Build index map for fast lookup
    let idx_map: HashMap<&str, usize> = memories
        .iter()
        .enumerate()
        .map(|(i, m)| (m.meta.id.as_str(), i))
        .collect();

    // Adjacency list (by index), undirected
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];

    // Explicit edges
    for (i, m) in memories.iter().enumerate() {
        for linked_id in m
            .meta
            .related
            .iter()
            .chain(m.meta.requires.iter())
            .chain(m.meta.optional.iter())
        {
            if let Some(&j) = idx_map.get(linked_id.as_str()) {
                if !adj[i].contains(&j) {
                    adj[i].push(j);
                }
                if !adj[j].contains(&i) {
                    adj[j].push(i);
                }
            }
        }
    }

    // Implicit tag co-occurrence edges (≥1 shared tag)
    for i in 0..n {
        for j in (i + 1)..n {
            let shared = memories[i]
                .meta
                .tags
                .iter()
                .any(|t| memories[j].meta.tags.contains(t));
            if shared {
                if !adj[i].contains(&j) {
                    adj[i].push(j);
                }
                if !adj[j].contains(&i) {
                    adj[j].push(i);
                }
            }
        }
    }

    // Also add wikilink edges to community adjacency
    for (i, m) in memories.iter().enumerate() {
        let wikilinks: Vec<String> = extract_wikilinks(&m.l1_content)
            .into_iter()
            .chain(extract_wikilinks(&m.l2_content))
            .collect();
        for linked_id in wikilinks {
            if let Some(&j) = idx_map.get(linked_id.as_str()) {
                if !adj[i].contains(&j) {
                    adj[i].push(j);
                }
                if !adj[j].contains(&i) {
                    adj[j].push(i);
                }
            }
        }
    }

    // LPA: initialize each node with its own label (index as label)
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

            // Count neighbor label frequencies
            let mut freq: HashMap<u32, usize> = HashMap::new();
            for &j in &adj[i] {
                *freq.entry(labels[j]).or_insert(0) += 1;
            }

            // Most frequent label; ties broken by smallest label (deterministic)
            let best_label = freq
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
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
/// Includes community assignment computed via LPA.
pub fn to_graph_data(memories: &[Memory], _decay_threshold: f64) -> GraphData {
    let graph = build_graph(memories);
    let community_map = compute_community_map(memories);

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

    for edge_idx in graph.edge_indices() {
        let (source_idx, target_idx) = graph.edge_endpoints(edge_idx).unwrap();
        let edge_type = graph[edge_idx].clone();
        edges.push(GraphEdge {
            source: graph[source_idx].clone(),
            target: graph[target_idx].clone(),
            edge_type,
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
                always_load: false,
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
