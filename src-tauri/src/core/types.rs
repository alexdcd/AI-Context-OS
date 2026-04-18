use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryOntology {
    Source,
    Entity,
    Concept,
    Synthesis,
    /// Any ontology value we don't natively recognize (legacy, UI-generated,
    /// or future variants). The memory is still loaded; only internal scoring
    /// falls back to a neutral weight. Frontmatter round-tripping is
    /// lossy for this variant — the original string is not preserved.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SystemRole {
    Rule,
    Skill,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum MemoryStatus {
    Unprocessed,
    Processed,
    /// Any status value we don't natively recognize (e.g. `normalized`,
    /// `promoted`, `discarded` from inbox workflows). Does not block loading.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMeta {
    pub id: String,
    #[serde(rename = "type", default = "default_ontology")]
    pub ontology: MemoryOntology,
    #[serde(default)]
    pub l0: String,
    #[serde(default = "default_importance")]
    pub importance: f64,
    #[serde(default = "default_decay_rate")]
    pub decay_rate: f64,
    #[serde(default = "Utc::now", skip_serializing)]
    pub last_access: DateTime<Utc>,
    #[serde(default, skip_serializing)]
    pub access_count: u32,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub related: Vec<String>,
    #[serde(default = "Utc::now")]
    pub created: DateTime<Utc>,
    #[serde(default = "Utc::now")]
    pub modified: DateTime<Utc>,
    #[serde(default = "default_version")]
    pub version: u32,
    // Skill-specific fields
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default)]
    pub optional: Vec<String>,
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub status: Option<MemoryStatus>,
    #[serde(default)]
    pub protected: bool,
    #[serde(default)]
    pub derived_from: Vec<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub folder_category: Option<String>,
    #[serde(default, skip_serializing, skip_deserializing)]
    pub system_role: Option<SystemRole>,
}

impl MemoryMeta {
    /// All explicit outgoing links (related + requires + optional).
    pub fn explicit_links(&self) -> impl Iterator<Item = &String> {
        self.related
            .iter()
            .chain(self.requires.iter())
            .chain(self.optional.iter())
    }
}

fn default_ontology() -> MemoryOntology {
    MemoryOntology::Unknown
}
fn default_importance() -> f64 {
    0.5
}
fn default_decay_rate() -> f64 {
    0.998
}
fn default_confidence() -> f64 {
    0.9
}
fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub meta: MemoryMeta,
    pub l1_content: String,
    pub l2_content: String,
    pub raw_content: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LoadLevel {
    L0,
    L1,
    L2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreBreakdown {
    pub semantic: f64,
    pub bm25: f64,
    pub recency: f64,
    pub importance: f64,
    pub access_frequency: f64,
    pub graph_proximity: f64,
    pub final_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredMemory {
    pub memory_id: String,
    pub l0: String,
    pub ontology: MemoryOntology,
    pub folder_category: Option<String>,
    pub system_role: Option<SystemRole>,
    pub load_level: LoadLevel,
    pub score: ScoreBreakdown,
    pub token_estimate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContextPayload {
    pub prompt_context: String,
    #[serde(default)]
    pub memory_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub ontology: MemoryOntology,
    pub folder_category: Option<String>,
    pub system_role: Option<SystemRole>,
    pub importance: f64,
    pub decay_score: f64,
    pub community: Option<u32>,
    pub degree: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GodNode {
    pub memory_id: String,
    pub l0: String,
    pub ontology: MemoryOntology,
    pub folder_category: Option<String>,
    pub system_role: Option<SystemRole>,
    pub degree: usize,
    pub importance: f64,
    /// positive = graph considers it more important than the engineer does
    pub mismatch_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub edge_type: String, // "related", "requires", "optional", "wikilink", "tag"
    /// Semantic weight of this edge (0.1–1.0). Higher = stronger affinity.
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_root_dir")]
    pub root_dir: String,
    #[serde(default = "default_token_budget")]
    pub default_token_budget: u32,
    #[serde(default = "default_decay_threshold")]
    pub decay_threshold: f64,
    #[serde(default = "default_scratch_ttl")]
    pub scratch_ttl_days: u32,
    #[serde(default)]
    pub active_tools: Vec<String>,
}

fn default_root_dir() -> String {
    "~/AI-Context-OS".to_string()
}
fn default_token_budget() -> u32 {
    4000
}
fn default_decay_threshold() -> f64 {
    0.1
}
fn default_scratch_ttl() -> u32 {
    7
}

impl Default for Config {
    fn default() -> Self {
        Self {
            root_dir: default_root_dir(),
            default_token_budget: default_token_budget(),
            decay_threshold: default_decay_threshold(),
            scratch_ttl_days: default_scratch_ttl(),
            active_tools: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyEntry {
    pub timestamp: DateTime<Utc>,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub summary: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    pub memory_a: String,
    pub memory_b: String,
    pub description: String,
    pub conflicting_terms: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidationSuggestion {
    pub entries: Vec<DailyEntry>,
    pub suggested_ontology: MemoryOntology,
    pub summary: String,
}

// ─── Journal types ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalBlock {
    pub id: String,
    #[serde(default)]
    pub indent: u32,
    pub content: String,
    #[serde(default)]
    pub children: Vec<JournalBlock>,
    #[serde(default)]
    pub task_state: Option<TaskState>,
    #[serde(default)]
    pub task_priority: Option<TaskPriority>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalPage {
    pub date: String, // YYYY-MM-DD
    pub blocks: Vec<JournalBlock>,
    pub raw_content: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalDateInfo {
    pub date: String, // YYYY-MM-DD
    pub block_count: u32,
    pub has_tasks: bool,
}

// ─── Task types ───

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Todo,
    InProgress,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskPriority {
    A,
    B,
    C,
}

impl TaskPriority {
    pub fn importance(&self) -> f64 {
        match self {
            TaskPriority::A => 0.9,
            TaskPriority::B => 0.6,
            TaskPriority::C => 0.3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub state: TaskState,
    pub priority: Option<TaskPriority>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source_date: Option<String>, // journal date YYYY-MM-DD if from journal
    pub source_file: Option<String>, // file path of origin
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub due: Option<String>, // YYYY-MM-DD due date
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFilter {
    pub state: Option<TaskState>,
    pub priority: Option<TaskPriority>,
    pub tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMemoryInput {
    pub id: String,
    pub ontology: MemoryOntology,
    pub l0: String,
    #[serde(default = "default_importance")]
    pub importance: f64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub l1_content: String,
    #[serde(default)]
    pub l2_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveMemoryInput {
    pub id: String,
    pub meta: MemoryMeta,
    pub l1_content: String,
    pub l2_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryFilter {
    pub ontology: Option<MemoryOntology>,
    pub tags: Option<Vec<String>>,
    pub min_importance: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InboxItemKind {
    Text,
    Link,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InboxItemStatus {
    New,
    Normalized,
    ProposalReady,
    Processed,
    Promoted,
    Discarded,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalAction {
    PromoteMemory,
    RouteToSources,
    UpdateMemory,
    Discard,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProposalState {
    Pending,
    Approved,
    Rejected,
    Applied,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InferenceProviderKind {
    Anthropic,
    #[serde(rename = "openai_compatible")]
    OpenAiCompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InferenceProviderPreset {
    Custom,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "openrouter")]
    OpenRouter,
    Ollama,
    LmStudio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum InferenceCapability {
    Proposal,
    Classification,
    Summary,
    Vision,
    Chat,
    Streaming,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InboxAttachment {
    pub path: String,
    pub original_name: String,
    pub mime: Option<String>,
    pub size: u64,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub kind: InboxItemKind,
    pub status: InboxItemStatus,
    pub capture_state: String,
    pub proposal_state: ProposalState,
    pub content_hash: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    pub path: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub l1_content: String,
    #[serde(default)]
    pub l2_content: String,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub original_file: Option<String>,
    #[serde(default)]
    pub mime: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub derived_from: Vec<String>,
    #[serde(default)]
    pub needs_extraction: bool,
    #[serde(default)]
    pub needs_inference: bool,
    #[serde(default)]
    pub attachments: Vec<InboxAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestProposal {
    pub id: String,
    pub item_id: String,
    pub item_path: String,
    pub action: ProposalAction,
    pub state: ProposalState,
    pub confidence: f64,
    pub rationale: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    #[serde(default)]
    pub destination: Option<String>,
    #[serde(default)]
    pub ontology: Option<MemoryOntology>,
    #[serde(default)]
    pub l0: Option<String>,
    #[serde(default)]
    pub l1_content: Option<String>,
    #[serde(default)]
    pub l2_content: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub derived_from: Vec<String>,
    #[serde(default)]
    pub inference_provider: Option<InferenceProviderKind>,
    #[serde(default)]
    pub inference_preset: Option<InferenceProviderPreset>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceProviderConfig {
    pub enabled: bool,
    pub kind: InferenceProviderKind,
    pub preset: InferenceProviderPreset,
    pub model: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<InferenceCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceProviderStatus {
    pub configured: bool,
    pub enabled: bool,
    pub healthy: bool,
    #[serde(default)]
    pub kind: Option<InferenceProviderKind>,
    #[serde(default)]
    pub preset: Option<InferenceProviderPreset>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<InferenceCapability>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInboxTextInput {
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateInboxLinkInput {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInboxItemInput {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub l1_content: Option<String>,
    #[serde(default)]
    pub l2_content: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<InboxItemStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyIngestProposalInput {
    pub proposal_id: String,
    #[serde(default)]
    pub destination_dir: Option<String>,
    #[serde(default)]
    pub memory_id_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentOperationalContext {
    pub recent_daily_entries: Vec<DailyEntry>,
    pub pending_proposals: Vec<IngestProposal>,
    pub recently_promoted: Vec<IngestProposal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn default_include_vault_context() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default = "default_include_vault_context")]
    pub include_vault_context: bool,
    #[serde(default)]
    pub context_prompt: Option<String>,
    #[serde(default)]
    pub context_memory_ids: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub text: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub context_memory_ids: Vec<String>,
    #[serde(default)]
    pub context_debug: Option<ChatContextDebug>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContextDebugMemory {
    pub id: String,
    #[serde(default)]
    pub score: Option<f64>,
    #[serde(default)]
    pub token_estimate: Option<u32>,
    #[serde(default)]
    pub load_level: Option<LoadLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatContextDebug {
    pub prompt_chars: u32,
    pub token_budget: u32,
    pub tokens_used: u32,
    pub memory_count: u32,
    pub memories: Vec<ChatContextDebugMemory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProvider {
    pub preset: InferenceProviderPreset,
    pub name: String,
    pub base_url: String,
    pub reachable: bool,
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub loaded: Option<bool>,
}
