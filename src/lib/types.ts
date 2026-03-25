export type MemoryType =
  | "context"
  | "daily"
  | "intelligence"
  | "project"
  | "resource"
  | "skill"
  | "task"
  | "rule"
  | "scratch";

export interface MemoryMeta {
  id: string;
  memory_type: MemoryType;
  l0: string;
  importance: number;
  always_load: boolean;
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
  memory_type: MemoryType;
  load_level: LoadLevel;
  score: ScoreBreakdown;
  token_estimate: number;
}

export interface GraphNode {
  id: string;
  label: string;
  memory_type: MemoryType;
  importance: number;
  decay_score: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: string;
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
  memory_type: MemoryType | null;
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
  suggested_type: MemoryType;
  suggested_folder: string;
  summary: string;
}

export interface CreateMemoryInput {
  id: string;
  memory_type: MemoryType;
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
  memory_type?: MemoryType;
  tags?: string[];
  min_importance?: number;
}

// UI helpers

export const MEMORY_TYPE_COLORS: Record<MemoryType, string> = {
  context: "#3b82f6",     // blue
  daily: "#f59e0b",       // amber
  intelligence: "#8b5cf6", // violet
  project: "#10b981",     // emerald
  resource: "#6366f1",    // indigo
  skill: "#22c55e",       // green
  task: "#ef4444",        // red
  rule: "#f43f5e",        // rose
  scratch: "#71717a",     // zinc
};

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  context: "Contexto",
  daily: "Daily",
  intelligence: "Inteligencia",
  project: "Proyecto",
  resource: "Recurso",
  skill: "Skill",
  task: "Tarea",
  rule: "Regla",
  scratch: "Scratch",
};
