import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  CreateMemoryInput,
  DailyEntry,
  FileNode,
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
}
export const runOnboarding = (profile: OnboardingProfile) =>
  invoke<boolean>("run_onboarding", { profile });
export const isOnboarded = () => invoke<boolean>("is_onboarded");
