use serde::{Deserialize, Serialize};

use crate::core::index::scan_memories;
use crate::core::memory::read_memory;
use crate::core::observability::ObservabilityDb;
use crate::core::types::MemoryType;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthBreakdown {
    pub coverage: f64,
    pub efficiency: f64,
    pub freshness: f64,
    pub balance: f64,
    pub cleanliness: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthScore {
    pub score: u32,
    pub breakdown: HealthBreakdown,
    pub summary: String,
}

/// Compute a health score (0-100) from 5 components.
pub fn compute_health_score(db: &ObservabilityDb, root: &Path) -> Result<HealthScore, String> {
    let all_entries = scan_memories(root);
    let total_memories = all_entries.len() as f64;

    if total_memories == 0.0 {
        return Ok(HealthScore {
            score: 0,
            breakdown: HealthBreakdown {
                coverage: 0.0,
                efficiency: 0.0,
                freshness: 0.0,
                balance: 0.0,
                cleanliness: 0.0,
            },
            summary: "Sin memorias en el workspace.".to_string(),
        });
    }

    let stats = db.get_stats(14).unwrap_or_default();

    // 1. Coverage (25%) — % of memories accessed in last 14 days
    let coverage = if total_memories > 0.0 {
        (stats.active_memories as f64 / total_memories).min(1.0) * 100.0
    } else {
        0.0
    };

    // 2. Efficiency (25%) — avg tokens_used/tokens_budget (ideal: 50-80%)
    let efficiency = {
        let eff = stats.efficiency_percent;
        if eff >= 50.0 && eff <= 80.0 {
            100.0
        } else if eff < 50.0 {
            (eff / 50.0) * 100.0
        } else {
            // > 80% — slightly penalize over-stuffing
            100.0 - ((eff - 80.0) / 20.0 * 50.0).min(50.0)
        }
    };

    // 3. Freshness (20%) — % of memories with recent last_access (< 14 days)
    let freshness = {
        let now = chrono::Utc::now();
        let fresh_count = all_entries
            .iter()
            .filter(|(meta, _)| {
                let age_days = (now - meta.last_access).num_days();
                age_days < 14
            })
            .count();
        (fresh_count as f64 / total_memories) * 100.0
    };

    // 4. Balance (15%) — distribution across memory types
    let balance = {
        let mut type_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for (meta, _) in &all_entries {
            let type_name = format!("{:?}", meta.memory_type);
            *type_counts.entry(type_name).or_insert(0) += 1;
        }
        let num_types = type_counts.len() as f64;
        // Ideal: at least 4 different types populated
        let type_diversity = (num_types / 4.0).min(1.0);
        // Check for extreme concentration (one type > 60%)
        let max_pct = type_counts.values().map(|c| *c as f64 / total_memories).fold(0.0, f64::max);
        let concentration_penalty = if max_pct > 0.6 { (max_pct - 0.6) * 100.0 } else { 0.0 };
        (type_diversity * 100.0 - concentration_penalty).max(0.0)
    };

    // 5. Cleanliness (15%) — inverse of pending high-impact optimizations
    let cleanliness = {
        let pending = db.get_pending_optimizations().unwrap_or_default();
        let high_impact_count = pending.iter().filter(|o| o.impact == "high").count();
        let medium_impact_count = pending.iter().filter(|o| o.impact == "medium").count();
        let penalty = (high_impact_count * 15 + medium_impact_count * 5) as f64;
        (100.0 - penalty).max(0.0)
    };

    // Weighted score
    let weighted = coverage * 0.25 + efficiency * 0.25 + freshness * 0.20 + balance * 0.15 + cleanliness * 0.15;
    let score = weighted.round() as u32;

    let summary = if score > 70 {
        "Workspace saludable.".to_string()
    } else if score > 40 {
        "Workspace necesita atencion. Revisa las optimizaciones.".to_string()
    } else {
        "Workspace en mal estado. Hay optimizaciones criticas pendientes.".to_string()
    };

    let breakdown = HealthBreakdown {
        coverage,
        efficiency,
        freshness,
        balance,
        cleanliness,
    };

    // Store snapshot
    let breakdown_json = serde_json::to_string(&breakdown).unwrap_or_default();
    let _ = db.insert_health_score(score, &breakdown_json);

    Ok(HealthScore {
        score,
        breakdown,
        summary,
    })
}

use crate::core::observability::ObservabilityStats;

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
