use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};

use crate::core::jsonl::create_jsonl_with_schema;
use crate::core::paths::SystemPaths;
use crate::core::types::Config;
use crate::core::watcher::start_watcher;
use crate::state::AppState;

/// Create the workspace directory structure and starter files.
/// Reusable by both init_workspace and onboarding.
pub fn create_workspace_structure(root: &Path, active_tools: &[String]) -> Result<Config, String> {
    let paths = SystemPaths::new(root);

    // Create all system directories
    for dir in paths.system_dirs() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }

    // Create config
    let config = Config {
        root_dir: root.to_string_lossy().to_string(),
        active_tools: if active_tools.is_empty() {
            vec!["claude".to_string()]
        } else {
            active_tools.to_vec()
        },
        ..Config::default()
    };
    let config_yaml =
        serde_yaml::to_string(&config).map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(paths.config_yaml(), config_yaml)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    let manifest = crate::core::router::build_router_manifest(&[], root, &config);
    let neutral_router = crate::core::router::render_static_router(&manifest);
    let claude_md = crate::core::compat::render_claude_adapter(&neutral_router);
    fs::write(paths.claude_md(), claude_md)
        .map_err(|e| format!("Failed to write claude.md: {}", e))?;
    fs::write(
        paths.cursorrules(),
        crate::core::compat::render_cursor_adapter(&neutral_router),
    )
    .map_err(|e| format!("Failed to write .cursorrules: {}", e))?;
    fs::write(
        paths.windsurfrules(),
        crate::core::compat::render_windsurf_adapter(&neutral_router),
    )
    .map_err(|e| format!("Failed to write .windsurfrules: {}", e))?;

    // Create JSONL files with schema lines
    create_jsonl_with_schema(&paths.daily_log(), "timestamp,type,summary,tags,source")?;

    // Create initial rich index + human-readable catalog
    let index = crate::core::router::generate_index_yaml(&manifest)
        .map_err(|e| format!("Failed to generate index.yaml: {}", e))?;
    fs::write(paths.index_yaml(), index)
        .map_err(|e| format!("Failed to write index.yaml: {}", e))?;
    fs::write(
        paths.catalog_md(),
        crate::core::router::render_catalog_markdown(&manifest),
    )
    .map_err(|e| format!("Failed to write catalog.md: {}", e))?;

    // Create folder contracts for system directories
    write_folder_contracts(&paths)?;

    // Create inbox ingestion protocol
    let ingest_instructions = r#"# Ingestion Instructions — AI Context OS

When processing files from `inbox/`, follow this protocol:

## 1. Analyze
- Read the full file
- Identify: content type, topic, language, relevance

## 2. Ask The User If Available
- Which project or area does this belong to?
- What importance level should it have?
- Are there tags or links to existing memories?
If the user is not available, classify it using your best judgment.

## 3. Process
- Generate complete YAML frontmatter (`id`, `type`, `l0`, `importance`, `tags`, etc.)
- `type` must be the ontology (`source`, `entity`, `concept`, or `synthesis`)
- Structure the content with `<!-- L1 -->` and `<!-- L2 -->`
- L1: executive summary (2-3 lines)
- L2: fully processed content

## 4. Classify And Route
- If it is original reference material, move it to `sources/` with `protected: true`
- If it is knowledge to integrate, create or update the corresponding memory and add `derived_from`
- If it has no lasting value, mark it as `processed` and leave it in inbox for the user to review

## 5. Post-Processing
- Update the original inbox file to `status: processed`
- If you created new memories, make sure `derived_from` points to the source
"#;
    fs::write(root.join("inbox/_INGEST.md"), ingest_instructions)
        .map_err(|e| format!("Failed to write _INGEST.md: {}", e))?;

    Ok(config)
}

pub fn read_config_from_root(root: &Path) -> Result<Option<Config>, String> {
    let paths = SystemPaths::new(root);
    // Try new path first, fall back to legacy
    let config_path = if paths.config_yaml().exists() {
        paths.config_yaml()
    } else if root.join("_config.yaml").exists() {
        root.join("_config.yaml")
    } else {
        return Ok(None);
    };
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config {}: {}", config_path.display(), e))?;
    let config: Config = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse config {}: {}", config_path.display(), e))?;
    Ok(Some(config))
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub fn sync_workspace_runtime(
    state: &crate::state::AppState,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    state.refresh_memory_index();

    if let Err(e) = state.rebind_observability() {
        state.clear_observability();
        log::warn!(
            "Failed to initialize observability DB for {}: {}",
            state.get_root().display(),
            e
        );
    }

    if let Some(app) = app {
        let root = state.get_root();
        if root.exists() {
            let recent_write_checker = {
                let recent_writes = state.recent_writes.clone();
                std::sync::Arc::new(move |path: &str| {
                    let mut recent_writes = recent_writes.lock().unwrap();
                    let now = std::time::Instant::now();
                    recent_writes.retain(|_, written_at| {
                        now.duration_since(*written_at) < std::time::Duration::from_secs(2)
                    });
                    recent_writes.contains_key(path)
                })
            };
            match start_watcher(
                root.clone(),
                app.clone(),
                Some(state.memory_index.clone()),
                recent_write_checker,
            ) {
                Ok(handle) => state.replace_watcher(Some(handle)),
                Err(e) => {
                    state.replace_watcher(None);
                    log::warn!("Failed to start watcher on {}: {}", root.display(), e);
                }
            }
        } else {
            state.replace_watcher(None);
        }
    }

    Ok(())
}

/// Write .folder.yaml contracts for system directories.
/// Uses write_if_not_exists so manual edits in existing workspaces are preserved.
fn write_folder_contracts(paths: &SystemPaths) -> Result<(), String> {
    let contracts: &[(&std::path::PathBuf, &str)] = &[
        (
            &paths.inbox_dir(),
            "role: inbox\n\
             description: Staging area for unprocessed incoming memories\n\
             lifecycle: transient\n\
             scannable: false\n\
             writable_by_mcp: true\n\
             required_fields: [id, kind, status]\n\
             optional_fields: [derived_from, tags, importance, source_url, original_file]\n\
             default_values:\n\
             \x20 status: unprocessed\n\
             \x20 importance: 0.3\n",
        ),
        (
            &paths.sources_dir(),
            "role: source\n\
             description: Original reference materials — not modified after ingestion\n\
             lifecycle: immutable\n\
             scannable: true\n\
             writable_by_mcp: false\n\
             required_fields: [id, type, l0]\n\
             optional_fields: [confidence, derived_from, tags]\n",
        ),
        (
            &paths.skills_dir(),
            "role: skill\n\
             description: Executable skills with trigger-based activation\n\
             lifecycle: permanent\n\
             scannable: true\n\
             writable_by_mcp: true\n\
             required_fields: [id, type, l0, triggers]\n\
             optional_fields: [requires, optional, output_format, tags]\n",
        ),
        (
            &paths.rules_dir(),
            "role: rule\n\
             description: Workspace rules loaded into the router\n\
             lifecycle: permanent\n\
             scannable: true\n\
             writable_by_mcp: true\n\
             required_fields: [id, type, l0]\n\
             optional_fields: [tags]\n",
        ),
    ];

    for (dir, content) in contracts {
        let contract_path = dir.join(".folder.yaml");
        if !contract_path.exists() {
            fs::write(&contract_path, content)
                .map_err(|e| format!("Failed to write {}: {}", contract_path.display(), e))?;
        }
    }

    Ok(())
}

/// Initialize the workspace directory structure.
#[tauri::command]
pub fn init_workspace(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let root = state.get_root();

    if root.join("claude.md").exists() {
        return Ok(false);
    }

    let config = create_workspace_structure(&root, &[])?;
    state.set_root(root.clone())?;
    *state.config.write().unwrap() = config;
    sync_workspace_runtime(state.inner(), Some(&app))?;

    Ok(true)
}

/// Get the current configuration.
#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<Config, String> {
    let root = state.get_root();
    if let Some(config) = read_config_from_root(&root)? {
        *state.config.write().unwrap() = config.clone();
        Ok(config)
    } else {
        Ok(state.config.read().unwrap().clone())
    }
}

/// Save configuration.
#[tauri::command]
pub fn save_config(config: Config, app: AppHandle, state: State<AppState>) -> Result<(), String> {
    let root = if config.root_dir.trim().is_empty() {
        state.get_root()
    } else {
        expand_home(&config.root_dir)
    };
    fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create workspace root {}: {}", root.display(), e))?;

    let paths = SystemPaths::new(&root);
    fs::create_dir_all(paths.ai_dir()).ok();
    let config_yaml =
        serde_yaml::to_string(&config).map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(paths.config_yaml(), config_yaml)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    state.set_root(root)?;
    *state.config.write().unwrap() = config;
    sync_workspace_runtime(state.inner(), Some(&app))?;
    Ok(())
}
