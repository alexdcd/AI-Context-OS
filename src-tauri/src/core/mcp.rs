use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use chrono::Utc;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::{tool, tool_handler, tool_router, ServerHandler};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::core::engine::{assemble_context_package, execute_context_query};
use crate::core::frontmatter::serialize_frontmatter;
use crate::core::index::scan_memories;
use crate::core::jsonl::append_jsonl;
use crate::core::levels::join_levels;
use crate::core::memory::read_memory;
use crate::core::observability::{classify_task, ObservabilityDb};
use crate::core::paths::{enrich_memory_meta, AI_DIR, RULES_DIR, SKILLS_DIR};
use crate::core::types::{Config, LoadLevel, MemoryMeta, MemoryOntology, SystemRole};
use crate::core::usage::record_accesses;
use crate::core::wikilinks::normalize_memory_bodies;

/// Shared state accessible by the MCP server tools.
pub struct McpSharedState {
    pub root_dir: Arc<RwLock<PathBuf>>,
    pub config: Arc<RwLock<Config>>,
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
    /// Unique memory ID in kebab-case. Becomes the filename (e.g. "project-roadmap" → project-roadmap.md)
    pub id: String,
    /// Ontology type: "source" (reference material), "entity" (people/projects/tools), "concept" (ideas/patterns), "synthesis" (analysis/decisions)
    pub ontology: String,
    /// One-line summary shown in the memory index. Keep it under 80 chars.
    pub l0: String,
    /// Importance score: 0.3=low, 0.5=normal, 0.7=high, 0.9=critical
    #[serde(default = "default_importance")]
    pub importance: f64,
    /// Tags for search and categorization
    #[serde(default)]
    pub tags: Vec<String>,
    /// Brief summary (50-150 words). Loaded first; should be enough for most tasks.
    #[serde(default)]
    pub l1_content: String,
    /// Full detail, examples, extended context. Loaded only when L1 is insufficient.
    #[serde(default)]
    pub l2_content: String,
    /// Destination folder relative to workspace root. Valid: "inbox" (default), ".ai/skills", ".ai/rules", or any user folder.
    pub folder: Option<String>,
}

fn default_importance() -> f64 {
    0.5
}

fn resolve_memory_folder(root: &std::path::Path, folder: Option<&str>) -> Result<PathBuf, String> {
    let requested = folder.unwrap_or("inbox").trim();
    if requested.is_empty() {
        return Ok(root.join("inbox"));
    }

    let relative = PathBuf::from(requested);
    if relative.is_absolute() {
        return Err("Folder must be relative to the workspace root".to_string());
    }

    for component in relative.components() {
        match component {
            std::path::Component::Normal(_) => {}
            _ => {
                return Err(
                    "Folder must be a simple relative workspace path without `..`".to_string(),
                )
            }
        }
    }

    let mut parts = relative
        .iter()
        .map(|part| part.to_string_lossy().to_string());
    let first = parts
        .next()
        .ok_or_else(|| "Folder cannot be empty".to_string())?;
    let second = parts.next();

    if first == AI_DIR {
        match second.as_deref() {
            Some(SKILLS_DIR) | Some(RULES_DIR) => {}
            _ => {
                return Err(
                    "Only `.ai/skills` and `.ai/rules` are valid MCP destinations inside `.ai/`"
                        .to_string(),
                )
            }
        }
    }

    Ok(root.join(relative))
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
        description = "Load relevant AI context for a task. Call this at the start of every task. Returns: workspace rules, scored memories at L1/L2 detail levels based on relevance, and a list of available but unloaded memories you can request later."
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

                let loaded_ids = result
                    .loaded
                    .iter()
                    .map(|mem| mem.memory_id.clone())
                    .collect::<Vec<_>>();
                let _ = record_accesses(&root, &loaded_ids, Utc::now());

                assemble_context_package(&result)
            }
            Err(e) => format!("Error loading context: {}", e),
        }
    }

    #[tool(
        name = "save_memory",
        description = "Create or update a memory file. Provide: id (kebab-case, becomes filename), ontology (source|entity|concept|synthesis), l0 (one-line summary), importance (0.0-1.0), l1_content (brief summary, 50-150 words), l2_content (full detail, optional). Saves to folder (default: inbox/)."
    )]
    async fn save_memory(&self, Parameters(params): Parameters<SaveMemoryParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();

        let ontology = match params.ontology.to_lowercase().as_str() {
            "source" => MemoryOntology::Source,
            "entity" => MemoryOntology::Entity,
            "concept" => MemoryOntology::Concept,
            "synthesis" => MemoryOntology::Synthesis,
            other => {
                return format!(
                    "Unknown ontology: '{}'. Valid: source, entity, concept, synthesis",
                    other
                )
            }
        };

        let all_entries = scan_memories(&root);

        let now = Utc::now();
        let existing = all_entries
            .iter()
            .find(|(meta, _)| meta.id == params.id)
            .cloned();
        let existing_id = existing.as_ref().map(|(existing_meta, _)| existing_meta.id.clone());
        let file_path = if let Some((existing_meta, existing_path)) = &existing {
            if existing_meta.protected {
                return format!(
                    "Memory '{}' is protected. Unprotect it before saving through MCP.",
                    existing_meta.id
                );
            }
            PathBuf::from(existing_path)
        } else {
            let target_folder = match resolve_memory_folder(&root, params.folder.as_deref()) {
                Ok(path) => path,
                Err(e) => return format!("Invalid folder: {}", e),
            };
            target_folder.join(format!("{}.md", params.id))
        };

        let mut meta = if let Some((existing_meta, _)) = existing {
            let mut meta = existing_meta;
            meta.ontology = ontology;
            meta.l0 = params.l0;
            meta.importance = params.importance.clamp(0.0, 1.0);
            meta.tags = params.tags;
            meta.modified = now;
            meta.version = meta.version.saturating_add(1);
            meta
        } else {
            MemoryMeta {
                id: params.id.clone(),
                ontology,
                l0: params.l0,
                importance: params.importance.clamp(0.0, 1.0),
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
                status: None,
                protected: false,
                derived_from: vec![],
                folder_category: None,
                system_role: None,
            }
        };
        enrich_memory_meta(&mut meta, &file_path, &root);

        let current_meta = meta.clone();
        let memories_snapshot: Vec<MemoryMeta> = all_entries.iter().map(|(meta, _)| meta.clone()).collect();
        let normalized = normalize_memory_bodies(
            &params.l1_content,
            &params.l2_content,
            &memories_snapshot,
            Some(&current_meta),
            existing_id.as_deref(),
        );

        let body = join_levels(&normalized.l1_content, &normalized.l2_content);
        match serialize_frontmatter(&meta, &body) {
            Ok(content) => {
                // Ensure directory exists
                if let Some(parent) = file_path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        return format!("Error creating directory: {}", e);
                    }
                }
                match std::fs::write(&file_path, content) {
                    Ok(_) => {
                        let config = self.state.config.read().unwrap().clone();
                        match crate::commands::router::regenerate_router_files(&root, &config) {
                            Ok(_) => {
                                if normalized.warnings.is_empty() {
                                    format!("Memory '{}' saved to {}", params.id, file_path.display())
                                } else {
                                    format!(
                                        "Memory '{}' saved to {} with {} wikilink warning(s)",
                                        params.id,
                                        file_path.display(),
                                        normalized.warnings.len()
                                    )
                                }
                            }
                            Err(e) => format!(
                                "Memory '{}' saved to {} but router regeneration failed: {}",
                                params.id,
                                file_path.display(),
                                e
                            ),
                        }
                    }
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
        let skill_entry = all_entries.iter().find(|(meta, _)| {
            meta.id == params.skill_id && meta.system_role == Some(SystemRole::Skill)
        });

        let (skill_meta, skill_path) = match skill_entry {
            Some(entry) => entry,
            None => return format!("Skill '{}' not found.", params.skill_id),
        };

        // Load skill content
        match read_memory(&root, std::path::Path::new(skill_path)) {
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
                        if let Some((_, dep_path)) =
                            all_entries.iter().find(|(m, _)| m.id == *req_id)
                        {
                            if let Ok(dep) = read_memory(&root, std::path::Path::new(dep_path)) {
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
                        all_entries.iter().any(|(m, _)| m.id == **opt_id)
                            && !loaded_ids.contains(opt_id)
                    })
                    .collect();

                if !optional_found.is_empty() {
                    output.push_str("---\n# CONTEXTO OPCIONAL\n\n");
                    for opt_id in optional_found {
                        if let Some((_, dep_path)) =
                            all_entries.iter().find(|(m, _)| m.id == *opt_id)
                        {
                            if let Ok(dep) = read_memory(&root, std::path::Path::new(dep_path)) {
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

        let _ = record_accesses(&root, &loaded_ids, Utc::now());
        output
    }

    #[tool(
        name = "log_session",
        description = "Log a structured session event to the daily JSONL log. Use for tracking milestones, errors, or session boundaries."
    )]
    async fn log_session(&self, Parameters(params): Parameters<LogSessionParams>) -> String {
        let root = self.state.root_dir.read().unwrap().clone();
        let today = Utc::now().format("%Y-%m-%d").to_string();
        let log_path = crate::core::paths::SystemPaths::new(&root)
            .sessions_dir()
            .join(format!("{}.jsonl", today));

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
        let mut info = rmcp::model::ServerInfo::default();
        info.instructions = Some("AI Context OS — Intelligent memory system for AI tools. Use get_context at the start of every task to load relevant context.".into());
        info
    }
}
