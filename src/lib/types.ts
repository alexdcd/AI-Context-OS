export type MemoryOntology = "source" | "entity" | "concept" | "synthesis";

export type SystemRole = "rule" | "skill";

export type MemoryStatus = "unprocessed" | "processed";

export interface MemoryMeta {
  id: string;
  ontology: MemoryOntology;
  l0: string;
  importance: number;
  decay_rate: number;
  last_access: string;
  access_count: number;
  confidence: number;
  tags: string[];
  related: string[];
  created: string;
  modified: string;
  version: number;
  triggers: string[];
  requires: string[];
  optional: string[];
  output_format: string | null;
  status: MemoryStatus | null;
  protected: boolean;
  derived_from: string[];
  folder_category: string | null;
  system_role: SystemRole | null;
}

export interface Memory {
  meta: MemoryMeta;
  l1_content: string;
  l2_content: string;
  raw_content: string;
  file_path: string;
}

export type RawFileKind = "jsonl" | "yaml" | "text";

export interface RawFileDocument {
  path: string;
  content: string;
  kind: RawFileKind;
}

export type LoadLevel = "l0" | "l1" | "l2";

export interface ScoreBreakdown {
  semantic: number;
  bm25: number;
  recency: number;
  importance: number;
  access_frequency: number;
  graph_proximity: number;
  final_score: number;
}

export interface ScoredMemory {
  memory_id: string;
  l0: string;
  ontology: MemoryOntology;
  folder_category: string | null;
  system_role: SystemRole | null;
  load_level: LoadLevel;
  score: ScoreBreakdown;
  token_estimate: number;
}

export interface GraphNode {
  id: string;
  label: string;
  ontology: MemoryOntology;
  folder_category: string | null;
  system_role: SystemRole | null;
  importance: number;
  decay_score: number;
  community: number | null;
  degree: number;
  preview: string;
}

export interface GodNode {
  memory_id: string;
  l0: string;
  ontology: MemoryOntology;
  folder_category: string | null;
  system_role: SystemRole | null;
  degree: number;
  importance: number;
  mismatch_score: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: string;
  /** Semantic weight of this edge (0.1–1.0). Higher = stronger affinity. */
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

export interface Config {
  root_dir: string;
  default_token_budget: number;
  decay_threshold: number;
  scratch_ttl_days: number;
  active_tools: string[];
}

export interface DailyEntry {
  timestamp: string;
  type: string;
  summary: string;
  tags: string[];
  source: string;
}

export interface Conflict {
  memory_a: string;
  memory_b: string;
  description: string;
  conflicting_terms: string[];
}

export interface ConsolidationSuggestion {
  entries: DailyEntry[];
  suggested_ontology: MemoryOntology;
  summary: string;
}

export interface JournalBlock {
  id: string;
  indent: number;
  content: string;
  children: JournalBlock[];
  task_state: TaskState | null;
  task_priority: TaskPriority | null;
}

export interface JournalPage {
  date: string;
  blocks: JournalBlock[];
  raw_content: string;
  file_path: string;
}

export interface JournalDateInfo {
  date: string;
  block_count: number;
  has_tasks: boolean;
}

export type TaskState = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "a" | "b" | "c";

export interface TaskItem {
  id: string;
  title: string;
  state: TaskState;
  priority: TaskPriority | null;
  tags: string[];
  source_date: string | null;
  source_file: string | null;
  created: string;
  modified: string;
  notes: string;
  due: string | null;
}

export interface TaskFilter {
  state?: TaskState;
  priority?: TaskPriority;
  tag?: string;
}

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const TASK_STATE_COLORS: Record<TaskState, string> = {
  todo: "#f59e0b",
  in_progress: "#3b82f6",
  done: "#10b981",
  cancelled: "#71717a",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  a: "High",
  b: "Medium",
  c: "Low",
};

export interface CreateMemoryInput {
  id: string;
  ontology: MemoryOntology;
  l0: string;
  importance: number;
  tags: string[];
  l1_content: string;
  l2_content: string;
}

export interface SaveMemoryInput {
  id: string;
  meta: MemoryMeta;
  l1_content: string;
  l2_content: string;
}

export interface MemoryFilter {
  ontology?: MemoryOntology;
  tags?: string[];
  min_importance?: number;
}

export interface ContextRequestRecord {
  id: number;
  timestamp: string;
  query: string;
  token_budget: number;
  tokens_used: number;
  memories_loaded: number;
  memories_available: number;
  source: string;
  session_id: string | null;
  task_type: string;
}

export interface ObservabilityStats {
  requests_this_week: number;
  requests_prev_week: number;
  tokens_served_total: number;
  tokens_avg_per_request: number;
  active_memories: number;
  total_memories: number;
  efficiency_percent: number;
  force_rate_percent: number;
}

export interface TopMemoryRecord {
  memory_id: string;
  times_served: number;
  typical_level: string;
  total_tokens: number;
  pct_of_requests: number;
}

export interface UnusedMemoryRecord {
  memory_id: string;
  last_served: string | null;
  days_since_use: number;
}

export interface HealthBreakdown {
  coverage: number;
  efficiency: number;
  freshness: number;
  balance: number;
  cleanliness: number;
}

export interface HealthScore {
  score: number;
  breakdown: HealthBreakdown;
  summary: string;
}

export interface HealthScoreSnapshot {
  date: string;
  score: number;
  breakdown: string;
}

export interface OptimizationRecord {
  id: number;
  timestamp: string;
  optimization_type: string;
  target_memory_id: string | null;
  secondary_memory_id: string | null;
  description: string;
  impact: string;
  evidence: string;
  estimated_token_saving: number | null;
  status: string;
}

export interface McpConnectionInfo {
  http_port: number;
  http_url: string;
  workspace_root: string;
  binary_path: string;
  is_http_running: boolean;
}

export interface ContextEventPayload {
  event_type: string;
  query: string;
  tokens_used: number;
  memories_loaded: number;
  timestamp: string;
}

export interface VaultEntry {
  name: string;
  path: string;
  last_accessed: string; // ISO 8601
  template: string;
  memory_count: number;
}

export const MEMORY_ONTOLOGY_COLORS: Record<MemoryOntology, string> = {
  source: "#0ea5e9",
  entity: "#10b981",
  concept: "#8b5cf6",
  synthesis: "#f59e0b",
};

