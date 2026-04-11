import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  CreateMemoryInput,
  DailyEntry,
  FileNode,
  GodNode,
  GraphData,
  JournalDateInfo,
  JournalPage,
  Memory,
  MemoryFilter,
  MemoryMeta,
  SaveMemoryInput,
  ScoredMemory,
  Conflict,
  ConsolidationSuggestion,
  TaskFilter,
  TaskItem,
  VaultEntry,
} from "./types";

// Config
export const initWorkspace = () => invoke<boolean>("init_workspace");
export const getConfig = () => invoke<Config>("get_config");
export const saveConfig = (config: Config) =>
  invoke<void>("save_config", { config });

// Memory CRUD
export const listMemories = (filter?: MemoryFilter) =>
  invoke<MemoryMeta[]>("list_memories", { filter: filter ?? null });
export const getMemory = (id: string) =>
  invoke<Memory>("get_memory", { id });
export const createMemory = (input: CreateMemoryInput) =>
  invoke<Memory>("create_memory", { input });
export const createMemoryAtPath = (input: CreateMemoryInput, parentDir: string) =>
  invoke<Memory>("create_memory_at_path", { input, parentDir });
export const saveMemory = (input: SaveMemoryInput) =>
  invoke<Memory>("save_memory", { input });
export const deleteMemory = (id: string) =>
  invoke<void>("delete_memory", { id });
export const renameMemoryFile = (path: string, newId: string) =>
  invoke<Memory>("rename_memory_file", { path, newId });
export const duplicateMemoryFile = (path: string, newId: string) =>
  invoke<Memory>("duplicate_memory_file", { path, newId });
export const moveMemoryFile = (path: string, destinationDir: string) =>
  invoke<Memory>("move_memory_file", { path, destinationDir });

// Filesystem
export const getFileTree = () => invoke<FileNode[]>("get_file_tree");
export const readFile = (path: string) =>
  invoke<string>("read_file", { path });
export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });
export const createDirectory = (path: string) =>
  invoke<string>("create_directory", { path });
export const renamePath = (oldPath: string, newPath: string) =>
  invoke<string>("rename_path", { oldPath, newPath });
export const deletePath = (path: string) =>
  invoke<void>("delete_path", { path });
export const duplicateFile = (path: string) =>
  invoke<string>("duplicate_file", { path });
export const showInFileManager = (path: string) =>
  invoke<void>("show_in_file_manager", { path });

// Router
export const regenerateRouter = () => invoke<string>("regenerate_router");
export const getRouterContent = () => invoke<string>("get_router_content");

// Scoring
export const simulateContext = (query: string, tokenBudget: number) =>
  invoke<ScoredMemory[]>("simulate_context", {
    query,
    token_budget: tokenBudget,
  });

// Graph
export const getGraphData = () => invoke<GraphData>("get_graph_data");
export const getGodNodes = () => invoke<GodNode[]>("get_god_nodes");

// Governance
export const getConflicts = () => invoke<Conflict[]>("get_conflicts");
export const getDecayCandidates = () =>
  invoke<MemoryMeta[]>("get_decay_candidates");
export const getConsolidationSuggestions = () =>
  invoke<ConsolidationSuggestion[]>("get_consolidation_suggestions");
export const getScratchCandidates = () =>
  invoke<string[]>("get_scratch_candidates");

// Daily
export const getDailyEntries = (date?: string) =>
  invoke<DailyEntry[]>("get_daily_entries", { date: date ?? null });
export const appendDailyEntry = (entry: DailyEntry) =>
  invoke<void>("append_daily_entry", { entry });

// Journal (Logseq-style daily pages)
export const getJournalPage = (date: string) =>
  invoke<JournalPage>("get_journal_page", { date });
export const saveJournalPage = (date: string, content: string) =>
  invoke<string>("save_journal_page", { date, content });
export const listJournalDates = () =>
  invoke<JournalDateInfo[]>("list_journal_dates");
export const getToday = () => invoke<string>("get_today");

// Tasks
export const listTasks = (filter?: TaskFilter) =>
  invoke<TaskItem[]>("list_tasks", { filter: filter ?? null });
export const createTask = (task: TaskItem) =>
  invoke<TaskItem>("create_task", { task });
export const updateTask = (task: TaskItem) =>
  invoke<TaskItem>("update_task", { task });
export const deleteTask = (id: string) =>
  invoke<void>("delete_task", { id });
export const toggleTaskState = (id: string) =>
  invoke<TaskItem>("toggle_task_state", { id });
export const generateTaskId = () => invoke<string>("generate_task_id");

// Backup
export const backupWorkspace = (destination: string) =>
  invoke<string>("backup_workspace", { destination });
export const restoreWorkspace = (source: string) =>
  invoke<boolean>("restore_workspace", { source });

// Onboarding
export interface OnboardingProfile {
  name: string;
  role: string;
  tools: string[];
  language: string;
  template: string;
  root_dir?: string;
  use_existing_root?: boolean;
}
export const runOnboarding = (profile: OnboardingProfile) =>
  invoke<boolean>("run_onboarding", { profile });
export const isOnboarded = () => invoke<boolean>("is_onboarded");

// Observability
import type {
  ContextRequestRecord,
  ObservabilityStats,
  TopMemoryRecord,
  UnusedMemoryRecord,
  HealthScore,
  HealthScoreSnapshot,
  OptimizationRecord,
  McpConnectionInfo,
} from "./types";

export const getRecentContextRequests = (limit: number) =>
  invoke<ContextRequestRecord[]>("get_recent_context_requests", { limit });
export const getObservabilityStats = (days: number) =>
  invoke<ObservabilityStats>("get_observability_stats", { days });
export const getTopMemoriesStats = (limit: number, days: number) =>
  invoke<TopMemoryRecord[]>("get_top_memories_stats", { limit, days });
export const getUnusedMemoriesStats = (days: number) =>
  invoke<UnusedMemoryRecord[]>("get_unused_memories_stats", { days });
export const getHealthScore = () =>
  invoke<HealthScore>("get_health_score");
export const getHealthHistory = (days: number) =>
  invoke<HealthScoreSnapshot[]>("get_health_history", { days });
export const getPendingOptimizations = () =>
  invoke<OptimizationRecord[]>("get_pending_optimizations");
export const applyOptimization = (id: number) =>
  invoke<void>("apply_optimization", { id });
export const dismissOptimization = (id: number) =>
  invoke<void>("dismiss_optimization", { id });
export const runOptimizationAnalysis = () =>
  invoke<OptimizationRecord[]>("run_optimization_analysis");
export const getMcpConnectionInfo = () =>
  invoke<McpConnectionInfo>("get_mcp_connection_info");

// Vault management
export const listVaults = () => invoke<VaultEntry[]>("list_vaults");
export const addVault = (path: string, name?: string) =>
  invoke<VaultEntry>("add_vault", { path, name: name ?? null });
export const removeVault = (path: string) =>
  invoke<void>("remove_vault", { path });
export const switchVault = (path: string) =>
  invoke<void>("switch_vault", { path });
export const renameVault = (path: string, name: string) =>
  invoke<void>("rename_vault", { path, name });
