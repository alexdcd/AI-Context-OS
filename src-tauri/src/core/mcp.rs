use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use chrono::Utc;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::core::engine::{assemble_context_package, execute_context_query};
use crate::core::frontmatter::serialize_frontmatter;
use crate::core::index::scan_memories;
use crate::core::jsonl::append_jsonl;
use crate::core::levels::join_levels;
use crate::core::memory::read_memory;
use crate::core::observability::{classify_task, ObservabilityDb};
use crate::core::types::{Config, LoadLevel, MemoryMeta, MemoryType};

/// Shared state accessible by the MCP server tools.
pub struct McpSharedState {
    pub root_dir: RwLock<PathBuf>,
    pub config: RwLock<Config>,
    pub observability: Arc<Mutex<Option<ObservabilityDb>>>,
}

// ─── Tool parameter types ───

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetContextParams {
    /// The task or query to find relevant context for
    pub query: String,
    /// Maximum tokens to use (default: 4000)
    #[serde(default = "default_budget")]
    pub token_budget: u32,
    /// Optional session identifier for tracking
    pub session_id: Option<String>,
}

fn default_budget() -> u32 {
    4000
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SaveMemoryParams {
    /// Unique memory ID (e.g. "mi-memoria-nueva")
    pub id: String,
    /// Memory type: context, daily, intelligence, project, resource, skill, task, rule, scratch
    pub memory_type: String,
    /// One-line summary (L0)
    pub l0: String,
    /// Importance from 0.0 to 1.0
    #[serde(default = "default_importance")]
    pub importance: f64,
    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,
    /// Main content (L1)
    #[serde(default)]
    pub l1_content: String,
    /// Extended detail content (L2)
    #[serde(default)]
    pub l2_content: String,
}

fn default_importance() -> f64 {
    0.5
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetSkillParams {
    /// The skill memory ID to load
    pub skill_id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct LogSessionParams {
    /// Type of event: start, end, milestone, error
    pub event_type: String,
    /// Description of the event
    pub summary: String,
    /// Tags for categorization
    #[serde(default)]
    pub tags: Vec<String>,
    /// Tool source: claude, cursor, windsurf, etc.
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "mcp".to_string()
}

#[derive(Debug, Serialize)]
struct SessionLogEntry {
    timestamp: String,
    #[serde(rename = "type")]
    entry_type: String,
    summary: String,
    tags: Vec<String>,
    source: String,
}

// ─── MCP Server ───

#[derive(Clone)]
pub struct AiContextMcpServer {
    tool_router: ToolRouter<Self>,
    state: Arc<McpSharedState>,
}

impl AiContextMcpServer {
    pub fn new(state: Arc<McpSharedState>) -> Self {
        Self {
            tool_router: Self::tool_router(),
            state,
        }
    }
}

#[tool_router]
impl AiContextMcpServer {
    #[tool(
        name = "get_context",
        description = "Load relevant AI context for a task. Returns rules, scored memories at appropriate detail levels, and a list of available but unloaded memories. Use this at the start of every task."
    )]
    async fn get_context(&self, Parameters(params): Parameters<GetContextParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();
        let config = self.state.config.read().unwrap().clone();

        let budget = if params.token_budget == 0 {
            config.default_token_budget
        } else {
            params.token_budget
        };

        match execute_context_query(&root, &params.query, budget, &config) {
            Ok(result) => {
                // Log to observability DB
                if let Ok(obs_guard) = self.state.observability.lock() {
                    if let Some(db) = obs_guard.as_ref() {
                        let task_type = classify_task(&params.query);
                        if let Ok(req_id) = db.log_context_request(
                            &params.query,
                            budget,
                            result.tokens_used,
                            result.loaded.len() as u32,
                            result.total_memories,
                            "mcp",
                            params.session_id.as_deref(),
                            task_type,
                        ) {
                            // Log loaded memories
                            for mem in &result.loaded {
                                let level_str = match mem.load_level {
                                    LoadLevel::L0 => "L0",
                                    LoadLevel::L1 => "L1",
                                    LoadLevel::L2 => "L2",
                                };
                                let _ = db.log_memory_served(
                                    req_id,
                                    &mem.memory_id,
                                    &mem.l0,
                                    level_str,
                                    mem.token_estimate,
                                    mem.score.final_score,
                                    mem.was_force_loaded,
                                );
                            }
                            // Log unloaded memories
                            for mem in &result.unloaded {
                                let _ = db.log_memory_not_loaded(
                                    req_id,
                                    &mem.memory_id,
                                    mem.score,
                                    &mem.reason,
                                );
                            }
                        }
                    }
                }

                assemble_context_package(&result)
            }
            Err(e) => format!("Error loading context: {}", e),
        }
    }

    #[tool(
        name = "save_memory",
        description = "Create or update a memory in the AI Context OS workspace. Memories persist knowledge for future AI sessions."
    )]
    async fn save_memory(&self, Parameters(params): Parameters<SaveMemoryParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();

        let memory_type = match params.memory_type.to_lowercase().as_str() {
            "context" => MemoryType::Context,
            "daily" => MemoryType::Daily,
            "intelligence" => MemoryType::Intelligence,
            "project" => MemoryType::Project,
            "resource" => MemoryType::Resource,
            "skill" => MemoryType::Skill,
            "task" => MemoryType::Task,
            "rule" => MemoryType::Rule,
            "scratch" => MemoryType::Scratch,
            other => return format!("Unknown memory type: '{}'. Valid: context, daily, intelligence, project, resource, skill, task, rule, scratch", other),
        };

        let folder = memory_type.folder_name();
        let file_path = root.join(folder).join(format!("{}.md", params.id));

        let now = Utc::now();
        let meta = MemoryMeta {
            id: params.id.clone(),
            memory_type,
            l0: params.l0,
            importance: params.importance.clamp(0.0, 1.0),
            always_load: false,
            decay_rate: 0.998,
            last_access: now,
            access_count: 0,
            confidence: 0.9,
            tags: params.tags,
            related: vec![],
            created: now,
            modified: now,
            version: 1,
            triggers: vec![],
            requires: vec![],
            optional: vec![],
            output_format: None,
        };

        let body = join_levels(&params.l1_content, &params.l2_content);
        match serialize_frontmatter(&meta, &body) {
            Ok(content) => {
                // Ensure directory exists
                if let Some(parent) = file_path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        return format!("Error creating directory: {}", e);
                    }
                }
                match std::fs::write(&file_path, content) {
                    Ok(_) => format!("Memory '{}' saved to {}", params.id, file_path.display()),
                    Err(e) => format!("Error writing file: {}", e),
                }
            }
            Err(e) => format!("Error serializing memory: {}", e),
        }
    }

    #[tool(
        name = "get_skill",
        description = "Load a skill memory and its full dependency chain (requires + optional). Returns the skill content plus all dependent memories assembled."
    )]
    async fn get_skill(&self, Parameters(params): Parameters<GetSkillParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();

        let all_entries = scan_memories(&root);
        let mut output = String::new();
        let mut loaded_ids: Vec<String> = Vec::new();

        // Find the skill
        let skill_entry = all_entries
            .iter()
            .find(|(meta, _)| meta.id == params.skill_id);

        let (skill_meta, skill_path) = match skill_entry {
            Some(entry) => entry,
            None => return format!("Skill '{}' not found.", params.skill_id),
        };

        // Load skill content
        match read_memory(std::path::Path::new(skill_path)) {
            Ok(mem) => {
                output.push_str(&format!("# SKILL: {} ({})\n\n", mem.meta.l0, mem.meta.id));
                if !mem.l1_content.is_empty() {
                    output.push_str(&mem.l1_content);
                    output.push_str("\n\n");
                }
                if !mem.l2_content.is_empty() {
                    output.push_str(&mem.l2_content);
                    output.push_str("\n\n");
                }
                loaded_ids.push(mem.meta.id.clone());

                // Load requires (mandatory dependencies)
                if !skill_meta.requires.is_empty() {
                    output.push_str("---\n# DEPENDENCIAS REQUERIDAS\n\n");
                    for req_id in &skill_meta.requires {
                        if let Some((_, dep_path)) = all_entries.iter().find(|(m, _)| m.id == *req_id) {
                            if let Ok(dep) = read_memory(std::path::Path::new(dep_path)) {
                                output.push_str(&format!("## {} ({})\n", dep.meta.l0, dep.meta.id));
                                if !dep.l1_content.is_empty() {
                                    output.push_str(&dep.l1_content);
                                    output.push_str("\n\n");
                                }
                                loaded_ids.push(dep.meta.id.clone());
                            }
                        }
                    }
                }

                // Load optional (if found)
                let optional_found: Vec<_> = skill_meta
                    .optional
                    .iter()
                    .filter(|opt_id| {
                        all_entries.iter().any(|(m, _)| m.id == **opt_id) && !loaded_ids.contains(opt_id)
                    })
                    .collect();

                if !optional_found.is_empty() {
                    output.push_str("---\n# CONTEXTO OPCIONAL\n\n");
                    for opt_id in optional_found {
                        if let Some((_, dep_path)) = all_entries.iter().find(|(m, _)| m.id == *opt_id) {
                            if let Ok(dep) = read_memory(std::path::Path::new(dep_path)) {
                                output.push_str(&format!("## {} ({})\n", dep.meta.l0, dep.meta.id));
                                if !dep.l1_content.is_empty() {
                                    output.push_str(&dep.l1_content);
                                    output.push_str("\n\n");
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => return format!("Error reading skill: {}", e),
        }

        output
    }

    #[tool(
        name = "log_session",
        description = "Log a structured session event to the daily JSONL log. Use for tracking milestones, errors, or session boundaries."
    )]
    async fn log_session(&self, Parameters(params): Parameters<LogSessionParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let log_path = root.join("02-daily").join("sessions").join(format!("{}.jsonl", today));

        let entry = SessionLogEntry {
            timestamp: Utc::now().to_rfc3339(),
            entry_type: params.event_type,
            summary: params.summary,
            tags: params.tags,
            source: params.source,
        };

        match append_jsonl(&log_path, &entry) {
            Ok(_) => format!("Session event logged to {}", log_path.display()),
            Err(e) => format!("Error logging session: {}", e),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AiContextMcpServer {
    fn get_info(&self) -> rmcp::model::ServerInfo {
        rmcp::model::ServerInfo {
            instructions: Some("AI Context OS — Intelligent memory system for AI tools. Use get_context at the start of every task to load relevant context.".into()),
            ..Default::default()
        }
    }
}
