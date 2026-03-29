mod commands;
mod core;
mod state;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use state::AppState;

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

            if !root.join("claude.md").exists() {
                log::info!("Workspace not found, will initialize on first use");
            } else {
                // Load memory index
                let all = crate::core::index::scan_memories(&root);
                let mut index = state.memory_index.write().unwrap();
                for (meta, path) in all {
                    index.insert(meta.id.clone(), (meta, path));
                }
                log::info!("Loaded {} memories from workspace", index.len());
            }

            // Initialize observability DB
            match crate::core::observability::ObservabilityDb::new(&root) {
                Ok(db) => {
                    *state.observability.lock().unwrap() = Some(db);
                    log::info!("Observability DB initialized");
                }
                Err(e) => {
                    log::warn!("Failed to initialize observability DB: {}", e);
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

            // Start filesystem watcher for live sync.
            if root.exists() {
                if let Err(e) = crate::core::watcher::start_watcher(root.clone(), app.handle().clone(), Some(state.memory_index.clone())) {
                    log::warn!("Failed to start watcher on {}: {}", root.display(), e);
                }
            }

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
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
