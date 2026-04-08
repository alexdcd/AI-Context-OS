mod core;

use std::path::PathBuf;

use chrono::Utc;
use clap::{Parser, Subcommand};
use rmcp::ServiceExt as _;

use std::sync::Arc;

use core::compat::{render_claude_adapter, render_cursor_adapter, render_windsurf_adapter};
use core::graph::get_community_map_for_scoring;
use core::index::scan_memories;
use core::memory::read_memory;
use core::router::{generate_index_yaml, generate_router_content};
use core::scoring::compute_score;
use core::types::{Config, Memory};

#[derive(Parser)]
#[command(name = "ai-context-cli")]
#[command(about = "AI Context OS — CLI for managing AI memory workspace")]
#[command(version)]
struct Cli {
    /// Workspace root directory (default: ~/AI-Context-OS)
    #[arg(short, long)]
    root: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize workspace directory structure
    Init,
    /// Search memories by query
    Search {
        /// Search query
        query: String,
        /// Maximum number of results
        #[arg(short = 'n', long, default_value = "10")]
        limit: usize,
    },
    /// Score memories for a query with token budget
    Score {
        /// Search query
        query: String,
        /// Token budget
        #[arg(short, long, default_value = "4000")]
        budget: u32,
    },
    /// Regenerate claude.md router and compatibility files
    Regenerate,
    /// List all memories
    List,
    /// Show memory details
    Show {
        /// Memory ID
        id: String,
    },
    /// Start MCP server (stdio transport for Claude Desktop/Code)
    McpServer,
}

fn get_root(root_opt: &Option<String>) -> PathBuf {
    if let Some(r) = root_opt {
        if r.starts_with("~/") {
            if let Some(home) = dirs::home_dir() {
                return home.join(&r[2..]);
            }
        }
        PathBuf::from(r)
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("AI-Context-OS")
    }
}

fn load_config(root: &PathBuf) -> Config {
    let paths = core::paths::SystemPaths::new(root);
    // Try .ai/config.yaml first (new path), fall back to legacy _config.yaml
    let config_path = if paths.config_yaml().exists() {
        paths.config_yaml()
    } else {
        root.join("_config.yaml")
    };
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_yaml::from_str(&content).unwrap_or_else(|_| Config {
            root_dir: root.to_string_lossy().to_string(),
            default_token_budget: 4000,
            decay_threshold: 0.1,
            scratch_ttl_days: 7,
            active_tools: vec!["claude".to_string()],
        })
    } else {
        Config {
            root_dir: root.to_string_lossy().to_string(),
            default_token_budget: 4000,
            decay_threshold: 0.1,
            scratch_ttl_days: 7,
            active_tools: vec!["claude".to_string()],
        }
    }
}

fn load_all_memories(root: &PathBuf) -> Vec<Memory> {
    let scanned = scan_memories(root);
    scanned
        .iter()
        .filter_map(|(_meta, path)| read_memory(std::path::Path::new(path)).ok())
        .collect()
}

fn main() {
    let cli = Cli::parse();
    let root = get_root(&cli.root);

    match cli.command {
        Commands::Init => {
            if root.join("claude.md").exists() {
                println!("Workspace already initialized at {}", root.display());
                return;
            }

            match core::paths::SystemPaths::new(&root).system_dirs().iter().try_for_each(|dir| {
                std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))
            }) {
                Ok(_) => {}
                Err(e) => {
                    eprintln!("Error creating workspace: {}", e);
                    return;
                }
            }

            let config = Config {
                root_dir: root.to_string_lossy().to_string(),
                default_token_budget: 4000,
                decay_threshold: 0.1,
                scratch_ttl_days: 7,
                active_tools: vec!["claude".to_string()],
            };
            let paths = core::paths::SystemPaths::new(&root);
            let yaml = serde_yaml::to_string(&config).unwrap();
            std::fs::write(paths.config_yaml(), yaml).unwrap();
            std::fs::write(
                paths.claude_md(),
                "# AI Context OS — Router\n\nInitialized.\n",
            )
            .unwrap();
            std::fs::write(paths.index_yaml(), "memories: []\n").unwrap();

            println!("Workspace initialized at {}", root.display());
        }

        Commands::Search { query, limit } => {
            let memories = load_all_memories(&root);
            if memories.is_empty() {
                println!("No memories found.");
                return;
            }

            let now = Utc::now();
            let community_map = get_community_map_for_scoring(&memories);
            let mut scored: Vec<(f64, &Memory)> = memories
                .iter()
                .map(|m| {
                    let sb = compute_score(&query, m, &memories, &[], &community_map, now);
                    (sb.final_score, m)
                })
                .collect();

            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());

            println!("Search results for: \"{}\"", query);
            println!("{:-<60}", "");
            for (i, (score, m)) in scored.iter().take(limit).enumerate() {
                println!("  {}. [{:.2}] {} ({})", i + 1, score, m.meta.l0, m.meta.id);
            }
        }

        Commands::Score { query, budget } => {
            let memories = load_all_memories(&root);
            if memories.is_empty() {
                println!("No memories found.");
                return;
            }

            let now = Utc::now();
            let community_map = get_community_map_for_scoring(&memories);
            let mut scored: Vec<(f64, &Memory, u32)> = memories
                .iter()
                .map(|m| {
                    let sb = compute_score(&query, m, &memories, &[], &community_map, now);
                    let tokens = core::levels::estimate_tokens(&m.l2_content);
                    (sb.final_score, m, tokens)
                })
                .collect();

            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());

            println!(
                "Context simulation: \"{}\" (budget: {} tokens)",
                query, budget
            );
            println!("{:-<60}", "");

            let mut used: u32 = 0;
            for (score, m, tokens) in &scored {
                if used + tokens > budget {
                    break;
                }
                used += tokens;
                println!(
                    "  [{:.2}] {} — ~{} tokens (total: {}/{})",
                    score, m.meta.l0, tokens, used, budget
                );
            }
            println!("{:-<60}", "");
            println!("Total tokens used: {}/{}", used, budget);
        }

        Commands::Regenerate => {
            let config = load_config(&root);
            let scanned = scan_memories(&root);
            let metas: Vec<_> = scanned.iter().map(|(m, _)| m.clone()).collect();

            let neutral = generate_router_content(&metas, &config);
            let claude_md = render_claude_adapter(&neutral);
            std::fs::write(root.join("claude.md"), &claude_md).unwrap();

            let index_yaml = generate_index_yaml(&metas);
            let paths = core::paths::SystemPaths::new(&root);
            std::fs::write(paths.index_yaml(), &index_yaml).unwrap();

            let cursorrules = render_cursor_adapter(&neutral);
            std::fs::write(root.join(".cursorrules"), &cursorrules).ok();
            let windsurfrules = render_windsurf_adapter(&neutral);
            std::fs::write(root.join(".windsurfrules"), &windsurfrules).ok();

            println!(
                "Regenerated: claude.md, .ai/index.yaml, .cursorrules, .windsurfrules ({} memories)",
                metas.len()
            );
        }

        Commands::List => {
            let scanned = scan_memories(&root);
            if scanned.is_empty() {
                println!("No memories found.");
                return;
            }

            println!("Memories ({}):", scanned.len());
            println!("{:-<60}", "");
            for (meta, _path) in &scanned {
                println!(
                    "  [{}] {} (type: {:?}, importance: {:.1})",
                    meta.id, meta.l0, meta.memory_type, meta.importance
                );
            }
        }

        Commands::Show { id } => {
            let scanned = scan_memories(&root);
            if let Some((_meta, path)) = scanned.iter().find(|(m, _)| m.id == id) {
                match read_memory(std::path::Path::new(path)) {
                    Ok(memory) => {
                        println!("ID: {}", memory.meta.id);
                        println!("Type: {:?}", memory.meta.memory_type);
                        println!("L0: {}", memory.meta.l0);
                        println!("Importance: {:.2}", memory.meta.importance);
                        println!("Tags: {}", memory.meta.tags.join(", "));
                        println!("Version: {}", memory.meta.version);
                        println!("{:-<60}", "");
                        println!("--- L1 ---");
                        println!("{}", memory.l1_content);
                        println!("--- L2 ---");
                        println!("{}", memory.l2_content);
                    }
                    Err(e) => println!("Error reading memory: {}", e),
                }
            } else {
                println!("Memory '{}' not found.", id);
            }
        }

        Commands::McpServer => {
            let config = load_config(&root);

            // Initialize observability DB
            let obs = match core::observability::ObservabilityDb::new(&root) {
                Ok(db) => Arc::new(std::sync::Mutex::new(Some(db))),
                Err(e) => {
                    eprintln!("Warning: Failed to init observability DB: {}", e);
                    Arc::new(std::sync::Mutex::new(None))
                }
            };

            let shared_state = Arc::new(core::mcp::McpSharedState {
                root_dir: Arc::new(std::sync::RwLock::new(root)),
                config: Arc::new(std::sync::RwLock::new(config)),
                observability: obs,
            });

            let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime");
            rt.block_on(async {
                let server = core::mcp::AiContextMcpServer::new(shared_state);
                let transport = rmcp::transport::io::stdio();
                match rmcp::ServiceExt::serve(server, transport).await {
                    Ok(ct) => {
                        if let Err(e) = ct.waiting().await {
                            eprintln!("MCP server error: {}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to start MCP server: {}", e);
                        std::process::exit(1);
                    }
                }
            });
        }
    }
}
