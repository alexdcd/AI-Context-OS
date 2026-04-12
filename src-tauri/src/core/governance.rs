use chrono::{DateTime, Utc};
use std::fs;
use std::path::Path;

use crate::core::decay::should_archive;
use crate::core::search::tokenize;
use crate::core::types::{Conflict, ConsolidationSuggestion, DailyEntry, Memory, MemoryMeta, MemoryOntology};

/// Detect potential conflicts between related memories.
/// Heuristic: if two related memories share tags but their L1 content contains
/// opposing signals (e.g., one says "React" and the other says "Vue" for stack).
pub fn detect_conflicts(memories: &[Memory]) -> Vec<Conflict> {
    let mut conflicts = Vec::new();

    for (_i, a) in memories.iter().enumerate() {
        for related_id in &a.meta.related {
            if let Some(b) = memories.iter().find(|m| &m.meta.id == related_id) {
                // Check for keyword-level contradictions
                let a_terms: std::collections::HashSet<String> =
                    tokenize(&a.l1_content).into_iter().collect();
                let b_terms: std::collections::HashSet<String> =
                    tokenize(&b.l1_content).into_iter().collect();

                // Look for technology pairs that might conflict
                let tech_pairs = [
                    ("react", "vue"),
                    ("react", "angular"),
                    ("vue", "angular"),
                    ("typescript", "javascript"),
                    ("tauri", "electron"),
                    ("postgres", "mysql"),
                    ("rest", "graphql"),
                ];

                for (term_a, term_b) in &tech_pairs {
                    let a_has_first = a_terms.contains(*term_a);
                    let a_has_second = a_terms.contains(*term_b);
                    let b_has_first = b_terms.contains(*term_a);
                    let b_has_second = b_terms.contains(*term_b);

                    if (a_has_first && b_has_second) || (a_has_second && b_has_first) {
                        conflicts.push(Conflict {
                            memory_a: a.meta.id.clone(),
                            memory_b: b.meta.id.clone(),
                            description: format!(
                                "{} mentions '{}' but {} mentions '{}'",
                                a.meta.id, term_a, b.meta.id, term_b
                            ),
                            conflicting_terms: vec![term_a.to_string(), term_b.to_string()],
                        });
                    }
                }
            }
        }
    }

    // Deduplicate (A-B and B-A are the same conflict)
    conflicts.dedup_by(|a, b| {
        (a.memory_a == b.memory_a && a.memory_b == b.memory_b)
            || (a.memory_a == b.memory_b && a.memory_b == b.memory_a)
    });

    conflicts
}

/// Find memories that should be flagged for archival based on decay.
pub fn find_decay_candidates(
    memories: &[MemoryMeta],
    now: DateTime<Utc>,
    threshold: f64,
) -> Vec<MemoryMeta> {
    memories
        .iter()
        .filter(|m| {
            let days = (now - m.last_access).num_hours() as f64 / 24.0;
            should_archive(m.decay_rate, m.access_count, days, threshold)
        })
        .cloned()
        .collect()
}

/// Check scratch directory for files older than TTL.
pub fn check_scratch_ttl(scratch_dir: &Path, ttl_days: u32) -> Vec<String> {
    let mut candidates = Vec::new();

    if !scratch_dir.exists() {
        return candidates;
    }

    let entries = match fs::read_dir(scratch_dir) {
        Ok(e) => e,
        Err(_) => return candidates,
    };

    let now = std::time::SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Ok(metadata) = path.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if let Ok(age) = now.duration_since(modified) {
                        if age.as_secs() > (ttl_days as u64) * 86400 {
                            candidates.push(path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    candidates
}

/// Suggest consolidation of daily log entries into permanent memories.
pub fn suggest_consolidation(entries: &[DailyEntry]) -> Vec<ConsolidationSuggestion> {
    let mut suggestions = Vec::new();

    // Group entries by type
    let mut decisions: Vec<&DailyEntry> = Vec::new();
    let mut ideas: Vec<&DailyEntry> = Vec::new();
    let mut meetings: Vec<&DailyEntry> = Vec::new();

    for entry in entries {
        match entry.entry_type.as_str() {
            "decision" => decisions.push(entry),
            "idea" => ideas.push(entry),
            "meeting" => meetings.push(entry),
            _ => {}
        }
    }

    if decisions.len() >= 3 {
        suggestions.push(ConsolidationSuggestion {
            entries: decisions.iter().map(|e| (*e).clone()).collect(),
            suggested_ontology: MemoryOntology::Entity,
            summary: format!(
                "{} decisions that could be documented as project decisions",
                decisions.len()
            ),
        });
    }

    if ideas.len() >= 3 {
        suggestions.push(ConsolidationSuggestion {
            entries: ideas.iter().map(|e| (*e).clone()).collect(),
            suggested_ontology: MemoryOntology::Synthesis,
            summary: format!(
                "{} ideas that could become intelligence/research notes",
                ideas.len()
            ),
        });
    }

    suggestions
}
