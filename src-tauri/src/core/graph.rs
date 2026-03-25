use std::collections::HashMap;

use chrono::Utc;
use petgraph::graph::{Graph, NodeIndex};
use petgraph::Undirected;

use crate::core::decay::decay_score;
use crate::core::types::{GraphData, GraphEdge, GraphNode, Memory};

/// Build an undirected graph from memory relationships.
pub fn build_graph(memories: &[Memory]) -> Graph<String, String, Undirected> {
    let mut graph = Graph::<String, String, Undirected>::new_undirected();
    let mut id_to_node: HashMap<String, NodeIndex> = HashMap::new();

    // Add nodes
    for m in memories {
        let idx = graph.add_node(m.meta.id.clone());
        id_to_node.insert(m.meta.id.clone(), idx);
    }

    // Add edges from `related` fields
    for m in memories {
        if let Some(&source) = id_to_node.get(&m.meta.id) {
            for related_id in &m.meta.related {
                if let Some(&target) = id_to_node.get(related_id) {
                    // Avoid duplicate edges
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "related".to_string());
                    }
                }
            }
            // Skill requires/optional edges
            for req_id in &m.meta.requires {
                if let Some(&target) = id_to_node.get(req_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "requires".to_string());
                    }
                }
            }
            for opt_id in &m.meta.optional {
                if let Some(&target) = id_to_node.get(opt_id) {
                    if !graph.contains_edge(source, target) {
                        graph.add_edge(source, target, "optional".to_string());
                    }
                }
            }
        }
    }

    graph
}

/// Convert the petgraph graph + memories into serializable GraphData for the frontend.
pub fn to_graph_data(memories: &[Memory], _decay_threshold: f64) -> GraphData {
    let graph = build_graph(memories);

    let id_map: HashMap<String, &Memory> = memories.iter().map(|m| (m.meta.id.clone(), m)).collect();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for node_idx in graph.node_indices() {
        let id = &graph[node_idx];
        if let Some(memory) = id_map.get(id) {
            let days_since_last_access =
                (Utc::now() - memory.meta.last_access).num_hours() as f64 / 24.0;
            nodes.push(GraphNode {
                id: id.clone(),
                label: memory.meta.l0.clone(),
                memory_type: memory.meta.memory_type.clone(),
                importance: memory.meta.importance,
                decay_score: decay_score(
                    memory.meta.decay_rate,
                    memory.meta.access_count,
                    days_since_last_access.max(0.0),
                ),
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

/// Get the count of connections for a memory (graph degree).
#[allow(dead_code)]
pub fn connection_count(memory_id: &str, memories: &[Memory]) -> usize {
    memories
        .iter()
        .filter(|m| {
            m.meta.related.contains(&memory_id.to_string())
                || m.meta.requires.contains(&memory_id.to_string())
                || m.meta.optional.contains(&memory_id.to_string())
        })
        .count()
}
