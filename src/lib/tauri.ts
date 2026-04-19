import { invoke } from "@tauri-apps/api/core";
import type {
  Config,
  CreateMemoryInput,
  CreateInboxLinkInput,
  CreateInboxTextInput,
  DailyEntry,
  DiscoveredProvider,
  FileNode,
  GodNode,
  GraphData,
  InferenceProviderConfig,
  InferenceProviderStatus,
  IngestProposal,
  InboxItem,
  JournalDateInfo,
  JournalPage,
  Memory,
  MemoryFilter,
  MemoryMeta,
  ApplyIngestProposalInput,
  ProviderModel,
  RecentOperationalContext,
  BacklinkRef,
  SaveMemoryInput,
  SaveMemoryResult,
  ScoredMemory,
  WikilinkResolution,
  Conflict,
  ConsolidationSuggestion,
  VaultEntry,
  UpdateInboxItemInput,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatContextPayload,
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
  invoke<SaveMemoryResult>("save_memory", { input });
export const deleteMemory = (id: string) =>
  invoke<void>("delete_memory", { id });
export const renameMemoryFile = (path: string, newId: string) =>
  invoke<Memory>("rename_memory_file", { path, newId });
export const duplicateMemoryFile = (path: string, newId: string) =>
  invoke<Memory>("duplicate_memory_file", { path, newId });
export const moveMemoryFile = (path: string, destinationDir: string) =>
  invoke<Memory>("move_memory_file", { path, destinationDir });
export const getBacklinks = (id: string) =>
  invoke<BacklinkRef[]>("get_backlinks", { id });
export const resolveWikilinkText = (text: string) =>
  invoke<WikilinkResolution>("resolve_wikilink_text", { text });

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
    tokenBudget,
  });
export const buildChatContext = (query: string, tokenBudget: number) =>
  invoke<ChatContextPayload>("build_chat_context", {
    query,
    tokenBudget,
  });

// Graph
export const getGraphData = () => invoke<GraphData>("get_graph_data");
export const getGodNodes = () => invoke<GodNode[]>("get_god_nodes");

// Inbox / ingest
export const listInboxItems = () => invoke<InboxItem[]>("list_inbox_items");
export const getInboxItem = (id: string) =>
  invoke<InboxItem>("get_inbox_item", { id });
export const createInboxText = (input: CreateInboxTextInput) =>
  invoke<InboxItem>("create_inbox_text", { input });
export const createInboxLink = (input: CreateInboxLinkInput) =>
  invoke<InboxItem>("create_inbox_link", { input });
export const importInboxFiles = (pathsToImport: string[]) =>
  invoke<InboxItem[]>("import_inbox_files", { pathsToImport });
export const updateInboxItem = (input: UpdateInboxItemInput) =>
  invoke<InboxItem>("update_inbox_item", { input });
export const normalizeInboxItem = (id: string) =>
  invoke<InboxItem>("normalize_inbox_item", { id });
export const normalizeInboxBatch = (ids: string[]) =>
  invoke<InboxItem[]>("normalize_inbox_batch", { ids });
export const listIngestProposals = () =>
  invoke<IngestProposal[]>("list_ingest_proposals");
export const generateIngestProposals = (itemIds: string[]) =>
  invoke<IngestProposal[]>("generate_ingest_proposals", { itemIds });
export const applyIngestProposal = (input: ApplyIngestProposalInput) =>
  invoke<IngestProposal>("apply_ingest_proposal", { input });
export const rejectIngestProposal = (proposalId: string) =>
  invoke<IngestProposal>("reject_ingest_proposal", { proposalId });
export const getRecentOperationalContext = () =>
  invoke<RecentOperationalContext>("get_recent_operational_context");
export const getInferenceProviderConfig = () =>
  invoke<InferenceProviderConfig | null>("get_inference_provider_config");
export const saveInferenceProviderConfig = (config: InferenceProviderConfig) =>
  invoke<InferenceProviderConfig>("save_inference_provider_config", { config });
export const getInferenceProviderStatus = () =>
  invoke<InferenceProviderStatus>("get_inference_provider_status");
export const testInferenceProvider = (config?: InferenceProviderConfig | null) =>
  invoke<InferenceProviderStatus>("test_inference_provider", { config: config ?? null });
export const chatCompletion = (request: ChatCompletionRequest) =>
  invoke<ChatCompletionResponse>("chat_completion", { request });
export const discoverLocalProviders = () =>
  invoke<DiscoveredProvider[]>("discover_local_providers");
export const listProviderModels = (config?: InferenceProviderConfig | null) =>
  invoke<ProviderModel[]>("list_provider_models", { config: config ?? null });
export const pullOllamaModel = (modelName: string) =>
  invoke<string>("pull_ollama_model", { modelName });
export const deleteOllamaModel = (modelName: string) =>
  invoke<void>("delete_ollama_model", { modelName });

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
