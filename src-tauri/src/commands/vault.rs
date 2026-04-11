use std::fs;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::core::paths::expand_home;
use crate::state::AppState;

const VAULTS_FILE: &str = ".ai-context-os-vaults.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub last_accessed: String, // ISO 8601
    pub template: String,      // "developer" | "creator" | "entrepreneur" | "custom" | ""
    pub memory_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct VaultsFile {
    vaults: Vec<VaultEntry>,
}

fn vaults_file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(VAULTS_FILE))
}

fn load_registry() -> VaultsFile {
    vaults_file_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_registry(vf: &VaultsFile) -> Result<(), String> {
    let path = vaults_file_path().ok_or_else(|| "Home directory not available".to_string())?;
    let json =
        serde_json::to_string_pretty(vf).map_err(|e| format!("Failed to serialize vaults: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn count_memories_in(root: &std::path::Path) -> usize {
    crate::core::index::scan_memories(root).len()
}

fn vault_name_from_path(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// List all known vaults. Memory counts are computed live.
#[tauri::command]
pub fn list_vaults(state: State<AppState>) -> Result<Vec<VaultEntry>, String> {
    let current_root = state.get_root();
    let current_str = current_root.to_string_lossy().to_string();

    let mut vf = load_registry();

    // Ensure the active vault is always present in the list
    if !vf
        .vaults
        .iter()
        .any(|v| expand_home(&v.path) == current_root)
    {
        vf.vaults.push(VaultEntry {
            name: vault_name_from_path(&current_root),
            path: current_str.clone(),
            last_accessed: Utc::now().to_rfc3339(),
            template: String::new(),
            memory_count: 0,
        });
        save_registry(&vf)?;
    }

    // Enrich memory_count live
    for entry in &mut vf.vaults {
        let p = expand_home(&entry.path);
        entry.memory_count = if p == current_root {
            state.memory_index.read().unwrap().len()
        } else {
            count_memories_in(&p)
        };
    }

    // Sort by last_accessed descending
    vf.vaults.sort_by(|a, b| b.last_accessed.cmp(&a.last_accessed));

    Ok(vf.vaults)
}

/// Register a vault path (creates directory if missing, initializes workspace if needed).
#[tauri::command]
pub fn add_vault(path: String, name: Option<String>) -> Result<VaultEntry, String> {
    let expanded = expand_home(&path);

    if !expanded.exists() {
        fs::create_dir_all(&expanded)
            .map_err(|e| format!("Cannot create directory: {}", e))?;
    }

    let display_name = name.unwrap_or_else(|| vault_name_from_path(&expanded));

    let mut vf = load_registry();

    // Deduplicate
    if vf.vaults.iter().any(|v| expand_home(&v.path) == expanded) {
        // Already registered — just return the existing entry
        let entry = vf
            .vaults
            .iter()
            .find(|v| expand_home(&v.path) == expanded)
            .cloned()
            .unwrap();
        return Ok(entry);
    }

    let entry = VaultEntry {
        name: display_name,
        path: expanded.to_string_lossy().to_string(),
        last_accessed: Utc::now().to_rfc3339(),
        template: String::new(),
        memory_count: count_memories_in(&expanded),
    };

    vf.vaults.push(entry.clone());
    save_registry(&vf)?;

    Ok(entry)
}

/// Remove a vault from the registry (does NOT delete files).
#[tauri::command]
pub fn remove_vault(path: String, state: State<AppState>) -> Result<(), String> {
    let target = expand_home(&path);
    let current = state.get_root();

    if target == current {
        return Err("Cannot remove the currently active vault".to_string());
    }

    let mut vf = load_registry();
    vf.vaults.retain(|v| expand_home(&v.path) != target);
    save_registry(&vf)
}

/// Switch the active vault. Initializes workspace structure if needed.
#[tauri::command]
pub fn switch_vault(
    path: String,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let new_root = expand_home(&path);

    if !new_root.exists() {
        return Err(format!("Path does not exist: {}", new_root.display()));
    }

    // Initialize workspace structure if this is a first-time open
    if !new_root.join("claude.md").exists() {
        crate::commands::config::create_workspace_structure(&new_root, &[])?;
    }

    state.set_root(new_root.clone())?;

    // Update last_accessed in registry
    let mut vf = load_registry();
    let now = Utc::now().to_rfc3339();

    if let Some(entry) = vf.vaults.iter_mut().find(|v| expand_home(&v.path) == new_root) {
        entry.last_accessed = now.clone();
        entry.memory_count = count_memories_in(&new_root);
    } else {
        // Vault not in registry yet — auto-register
        vf.vaults.push(VaultEntry {
            name: vault_name_from_path(&new_root),
            path: new_root.to_string_lossy().to_string(),
            last_accessed: now,
            template: String::new(),
            memory_count: count_memories_in(&new_root),
        });
    }
    save_registry(&vf)?;

    // Rebind runtime services to the new root
    crate::commands::config::sync_workspace_runtime(state.inner(), Some(&app))?;

    Ok(())
}

/// Upsert a vault entry with a known template. Called after onboarding to persist the template choice.
pub fn register_vault_with_template(root: &std::path::Path, template: &str) -> Result<(), String> {
    let mut vf = load_registry();
    if let Some(entry) = vf.vaults.iter_mut().find(|v| expand_home(&v.path) == root) {
        entry.template = template.to_string();
    } else {
        vf.vaults.push(VaultEntry {
            name: vault_name_from_path(root),
            path: root.to_string_lossy().to_string(),
            last_accessed: Utc::now().to_rfc3339(),
            template: template.to_string(),
            memory_count: 0,
        });
    }
    save_registry(&vf)
}

/// Update the display name of a vault in the registry.
#[tauri::command]
pub fn rename_vault(path: String, name: String) -> Result<(), String> {
    let target = expand_home(&path);
    let mut vf = load_registry();
    if let Some(entry) = vf.vaults.iter_mut().find(|v| expand_home(&v.path) == target) {
        entry.name = name;
    }
    save_registry(&vf)
}
