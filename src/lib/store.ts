import { create } from "zustand";
import type {
  FileNode,
  GraphData,
  Memory,
  MemoryMeta,
  RawFileDocument,
  RawFileKind,
} from "./types";
import * as api from "./tauri";

interface AppStore {
  // State
  initialized: boolean;
  fileTree: FileNode[];
  memories: MemoryMeta[];
  activeMemory: Memory | null;
  activeRawFile: RawFileDocument | null;
  selectedPath: string | null;
  graphData: GraphData | null;
  loading: boolean;
  error: string | null;
  explorerOpen: boolean;
  isCreateMemoryOpen: boolean;

  // Actions
  initialize: () => Promise<void>;
  loadFileTree: () => Promise<void>;
  loadMemories: () => Promise<void>;
  selectFile: (id: string) => Promise<void>;
  selectRawFile: (path: string) => Promise<void>;
  saveRawFile: (path: string, content: string) => Promise<void>;
  clearSelection: () => void;
  saveActiveMemory: (
    sourceId: string,
    l1: string,
    l2: string,
    meta: MemoryMeta,
    refreshDerivedState?: boolean,
  ) => Promise<Memory>;
  deleteMemory: (id: string) => Promise<void>;
  loadGraph: () => Promise<void>;
  regenerateRouter: () => Promise<void>;
  setError: (error: string | null) => void;
  toggleExplorer: () => void;
  setExplorerOpen: (open: boolean) => void;
  toggleCreateMemory: () => void;
  setCreateMemoryOpen: (v: boolean) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  fileTree: [],
  memories: [],
  activeMemory: null,
  activeRawFile: null,
  selectedPath: null,
  graphData: null,
  loading: false,
  error: null,
  explorerOpen: true,
  isCreateMemoryOpen: false,

  initialize: async () => {
    try {
      set({ loading: true });
      const created = await api.initWorkspace();
      if (created) {
        await api.regenerateRouter();
      }
      await get().loadFileTree();
      await get().loadMemories();
      await get().loadGraph();
      set({ initialized: true, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadFileTree: async () => {
    try {
      const tree = await api.getFileTree();
      set({ fileTree: tree });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMemories: async () => {
    try {
      const memories = await api.listMemories();
      set({ memories });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectFile: async (id: string) => {
    try {
      set({ loading: true });
      const memory = await api.getMemory(id);
      set({
        activeMemory: memory,
        activeRawFile: null,
        selectedPath: memory.file_path,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectRawFile: async (path: string) => {
    try {
      set({ loading: true });
      const content = await api.readFile(path);
      const kind = inferRawFileKind(path);
      set({
        activeMemory: null,
        activeRawFile: { path, content, kind },
        selectedPath: path,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveRawFile: async (path: string, content: string) => {
    try {
      await api.writeFile(path, content);
      markRecentLocalWrite(path);
      set((state) => ({
        activeRawFile:
          state.activeRawFile?.path === path
            ? { ...state.activeRawFile, content }
            : state.activeRawFile,
      }));
    } catch (e) {
      const message = String(e);
      set({ error: message });
      throw new Error(message);
    }
  },

  clearSelection: () => {
    set({ activeMemory: null, activeRawFile: null, selectedPath: null });
  },

  saveActiveMemory: async (sourceId, l1, l2, meta, refreshDerivedState = false) => {
    try {
      const saved = await api.saveMemory({
        id: sourceId,
        meta,
        l1_content: l1,
        l2_content: l2,
      });
      markRecentLocalWrite(saved.file_path);
      set((state) => {
        const isStillActive =
          state.activeMemory?.meta.id === sourceId ||
          state.activeMemory?.meta.id === saved.meta.id;

        return isStillActive
          ? {
              activeMemory: saved,
              activeRawFile: null,
              selectedPath: saved.file_path,
            }
          : {};
      });
      if (refreshDerivedState) {
        await get().loadMemories();
        await get().loadFileTree();
        await get().loadGraph();
      }
      return saved;
    } catch (e) {
      const message = String(e);
      set({ error: message });
      throw new Error(message);
    }
  },

  deleteMemory: async (id) => {
    try {
      set({ loading: true });
      await api.deleteMemory(id);
      const active = get().activeMemory;
      if (active?.meta.id === id) {
        set({
          activeMemory: null,
          activeRawFile: null,
          selectedPath: null,
          loading: false,
        });
      } else {
        set({ loading: false });
      }
      await get().loadMemories();
      await get().loadFileTree();
      await get().loadGraph();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadGraph: async () => {
    try {
      const graphData = await api.getGraphData();
      set({ graphData });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  regenerateRouter: async () => {
    try {
      await api.regenerateRouter();
      await get().loadMemories();
      await get().loadFileTree();
      await get().loadGraph();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setError: (error) => set({ error }),
  toggleExplorer: () => set((s) => ({ explorerOpen: !s.explorerOpen })),
  setExplorerOpen: (open) => set({ explorerOpen: open }),
  toggleCreateMemory: () => set((s) => ({ isCreateMemoryOpen: !s.isCreateMemoryOpen })),
  setCreateMemoryOpen: (v) => set({ isCreateMemoryOpen: v }),
}));

const RECENT_LOCAL_WRITE_WINDOW_MS = 2_000;
const recentLocalWrites = new Map<string, number>();

function markRecentLocalWrite(path: string) {
  const now = Date.now();
  pruneRecentLocalWrites(now);
  recentLocalWrites.set(path, now);
}

export function wasRecentlyWrittenLocally(path: string) {
  const now = Date.now();
  pruneRecentLocalWrites(now);
  const writtenAt = recentLocalWrites.get(path);
  return writtenAt !== undefined && now - writtenAt < RECENT_LOCAL_WRITE_WINDOW_MS;
}

function pruneRecentLocalWrites(now: number) {
  for (const [path, writtenAt] of recentLocalWrites.entries()) {
    if (now - writtenAt >= RECENT_LOCAL_WRITE_WINDOW_MS) {
      recentLocalWrites.delete(path);
    }
  }
}

function inferRawFileKind(path: string): RawFileKind {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".jsonl")) return "jsonl";
  if (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")) return "yaml";
  return "text";
}
