use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::core::paths::SystemPaths;
use crate::core::types::MemoryMeta;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryUsageEntry {
    #[serde(default = "Utc::now")]
    pub last_access: DateTime<Utc>,
    #[serde(default)]
    pub access_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MemoryUsageStore {
    #[serde(default)]
    memories: HashMap<String, MemoryUsageEntry>,
}

pub fn load_usage_map(root: &Path) -> HashMap<String, MemoryUsageEntry> {
    let path = SystemPaths::new(root).usage_json();
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return HashMap::new(),
    };

    serde_json::from_str::<MemoryUsageStore>(&raw)
        .map(|store| store.memories)
        .unwrap_or_default()
}

pub fn apply_usage(meta: &mut MemoryMeta, usage: Option<&MemoryUsageEntry>) {
    if let Some(usage) = usage {
        meta.last_access = usage.last_access;
        meta.access_count = usage.access_count;
    } else {
        meta.last_access = meta.modified;
        meta.access_count = 0;
    }
}

pub fn record_access(root: &Path, memory_id: &str, timestamp: DateTime<Utc>) -> Result<(), String> {
    record_accesses(root, &[memory_id.to_string()], timestamp)
}

pub fn record_accesses(
    root: &Path,
    memory_ids: &[String],
    timestamp: DateTime<Utc>,
) -> Result<(), String> {
    if memory_ids.is_empty() {
        return Ok(());
    }

    let paths = SystemPaths::new(root);
    if let Some(parent) = paths.usage_json().parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create usage state dir {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    let mut store = MemoryUsageStore {
        memories: load_usage_map(root),
    };

    for memory_id in memory_ids {
        let entry = store
            .memories
            .entry(memory_id.clone())
            .or_insert(MemoryUsageEntry {
                last_access: timestamp,
                access_count: 0,
            });
        entry.last_access = timestamp;
        entry.access_count = entry.access_count.saturating_add(1);
    }

    let serialized = serde_json::to_string_pretty(&store)
        .map_err(|e| format!("Failed to serialize usage store: {}", e))?;
    fs::write(paths.usage_json(), serialized).map_err(|e| {
        format!(
            "Failed to write usage store {}: {}",
            paths.usage_json().display(),
            e
        )
    })
}
