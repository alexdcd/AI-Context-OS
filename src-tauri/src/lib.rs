mod commands;
mod core;
mod state;

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::ServiceExt as _;
use tauri::Manager;

use state::AppState;

fn default_cli_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI-Context-OS")
}

fn expand_cli_root(root: Option<String>) -> PathBuf {
    match root {
        Some(path) if path == "~" => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
        Some(path) if path.starts_with("~/") => dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(&path[2..]),
        Some(path) => PathBuf::from(path),
        None => default_cli_root(),
    }
}

fn load_cli_config(root: &PathBuf) -> crate::core::types::Config {
    crate::commands::config::read_config_from_root(root)
        .ok()
        .flatten()
        .unwrap_or(crate::core::types::Config {
            root_dir: root.to_string_lossy().to_string(),
            default_token_budget: 4000,
            decay_threshold: 0.1,
            scratch_ttl_days: 7,
            active_tools: vec!["claude".to_string()],
        })
}

pub fn try_run_embedded_mcp_server() -> Result<bool, String> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        return Ok(false);
    };
    if command != "mcp-server" {
        return Ok(false);
    }

    let mut root_arg: Option<String> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--root" | "-r" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing value for --root".to_string())?;
                root_arg = Some(value);
            }
            other => {
                return Err(format!("Unknown mcp-server argument: {}", other));
            }
        }
    }

    let root = expand_cli_root(root_arg);
    let config = load_cli_config(&root);

    let obs = match crate::core::observability::ObservabilityDb::new(&root) {
        Ok(db) => Arc::new(std::sync::Mutex::new(Some(db))),
        Err(e) => {
            eprintln!("Warning: Failed to init observability DB: {}", e);
            Arc::new(std::sync::Mutex::new(None))
        }
    };

    let shared_state = Arc::new(crate::core::mcp::McpSharedState {
        root_dir: Arc::new(std::sync::RwLock::new(root)),
        config: Arc::new(std::sync::RwLock::new(config)),
        observability: obs,
    });

    let rt = tokio::runtime::Runtime::new().map_err(|e| format!("Failed to create tokio runtime: {}", e))?;
    rt.block_on(async {
        let server = crate::core::mcp::AiContextMcpServer::new(shared_state);
        let transport = rmcp::transport::io::stdio();
        match rmcp::ServiceExt::serve(server, transport).await {
            Ok(ct) => {
                if let Err(e) = ct.waiting().await {
                    eprintln!("MCP server error: {}", e);
                }
            }
            Err(e) => {
                return Err(format!("Failed to start MCP server: {}", e));
            }
        }
        Ok(())
    })?;

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // Config
            commands::config::init_workspace,
            commands::config::get_config,
            commands::config::save_config,
            // Memory CRUD
            commands::memory::list_memories,
            commands::memory::get_memory,
            commands::memory::create_memory,
            commands::memory::create_memory_at_path,
            commands::memory::save_memory,
            commands::memory::delete_memory,
            commands::memory::rename_memory_file,
            commands::memory::duplicate_memory_file,
            commands::memory::move_memory_file,
            // Filesystem
            commands::filesystem::get_file_tree,
            commands::filesystem::read_file,
            commands::filesystem::write_file,
            commands::filesystem::create_directory,
            commands::filesystem::rename_path,
            commands::filesystem::delete_path,
            commands::filesystem::duplicate_file,
            commands::filesystem::show_in_file_manager,
            // Router
            commands::router::regenerate_router,
            commands::router::get_router_content,
            // Scoring
            commands::scoring::simulate_context,
            // Graph
            commands::graph::get_graph_data,
            // Governance
            commands::governance::get_conflicts,
            commands::governance::get_decay_candidates,
            commands::governance::get_consolidation_suggestions,
            commands::governance::get_scratch_candidates,
            // Daily (JSONL system events)
            commands::daily::get_daily_entries,
            commands::daily::append_daily_entry,
            // Journal (Logseq-style daily pages)
            commands::journal::get_journal_page,
            commands::journal::save_journal_page,
            commands::journal::list_journal_dates,
            commands::journal::get_today,
            // Tasks
            commands::tasks::list_tasks,
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::delete_task,
            commands::tasks::toggle_task_state,
            commands::tasks::generate_task_id,
            // Onboarding
            commands::onboarding::run_onboarding,
            commands::onboarding::is_onboarded,
            // Backup
            commands::backup::backup_workspace,
            commands::backup::restore_workspace,
            // Observability
            commands::observability::get_recent_context_requests,
            commands::observability::get_observability_stats,
            commands::observability::get_top_memories_stats,
            commands::observability::get_unused_memories_stats,
            commands::observability::get_health_score,
            commands::observability::get_health_history,
            commands::observability::get_pending_optimizations,
            commands::observability::apply_optimization,
            commands::observability::dismiss_optimization,
            commands::observability::run_optimization_analysis,
            commands::observability::get_mcp_connection_info,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            let mut root = state.get_root();

            // Hydrate runtime config/root from _config.yaml when available.
            if let Ok(Some(config)) = crate::commands::config::read_config_from_root(&root) {
                *state.config.write().unwrap() = config.clone();
                let configured_root = PathBuf::from(&config.root_dir);
                if configured_root != root {
                    if state.set_root(configured_root.clone()).is_ok() {
                        root = configured_root;
                    }
                }
            }

            // Spawn MCP HTTP server (shares AppState locks to stay in sync)
            {
                let shared_state = Arc::new(crate::core::mcp::McpSharedState {
                    root_dir: state.root_dir.clone(),
                    config: state.config.clone(),
                    observability: state.observability.clone(),
                });
                tauri::async_runtime::spawn(async move {
                    match crate::core::mcp_http::spawn_mcp_http_server(shared_state).await {
                        Ok(port) => log::info!("MCP HTTP server running on port {}", port),
                        Err(e) => log::warn!("Failed to start MCP HTTP server: {}", e),
                    }
                });
            }

            if !root.join("claude.md").exists() {
                log::info!("Workspace not found, will initialize on first use");
            }

            crate::commands::config::sync_workspace_runtime(state.inner(), Some(&app.handle().clone()))?;
            log::info!("Loaded {} memories from workspace", state.memory_index.read().unwrap().len());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Flush watcher-updated access counts to disk
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(index) = state.memory_index.read() {
                        for (_id, (meta, path)) in index.iter() {
                            if meta.access_count > 0 {
                                if let Ok(mut memory) = crate::core::memory::read_memory(std::path::Path::new(path)) {
                                    if memory.meta.access_count != meta.access_count {
                                        memory.meta.access_count = meta.access_count;
                                        memory.meta.last_access = meta.last_access;
                                        let _ = crate::core::memory::write_memory(std::path::Path::new(path), &memory);
                                    }
                                }
                            }
                        }
                    }
                    state.replace_watcher(None);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
