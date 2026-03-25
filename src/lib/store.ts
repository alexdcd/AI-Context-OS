import { create } from "zustand";
import type { FileNode, Memory, MemoryMeta, GraphData } from "./types";
import * as api from "./tauri";

interface AppStore {
  // State
  initialized: boolean;
  fileTree: FileNode[];
  memories: MemoryMeta[];
  activeMemory: Memory | null;
  selectedPath: string | null;
  graphData: GraphData | null;
  loading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  loadFileTree: () => Promise<void>;
  loadMemories: () => Promise<void>;
  selectFile: (id: string) => Promise<void>;
  clearSelection: () => void;
  saveActiveMemory: (l1: string, l2: string, meta: MemoryMeta) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  loadGraph: () => Promise<void>;
  regenerateRouter: () => Promise<void>;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  fileTree: [],
  memories: [],
  activeMemory: null,
  selectedPath: null,
  graphData: null,
  loading: false,
  error: null,

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
      set({ activeMemory: memory, selectedPath: memory.file_path, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  clearSelection: () => {
    set({ activeMemory: null, selectedPath: null });
  },

  saveActiveMemory: async (l1, l2, meta) => {
    try {
      set({ loading: true });
      const saved = await api.saveMemory({
        id: meta.id,
        meta,
        l1_content: l1,
        l2_content: l2,
      });
      set({ activeMemory: saved, loading: false });
      await get().loadMemories();
      await get().loadFileTree();
      await get().loadGraph();
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  deleteMemory: async (id) => {
    try {
      set({ loading: true });
      await api.deleteMemory(id);
      const active = get().activeMemory;
      if (active?.meta.id === id) {
        set({ activeMemory: null, selectedPath: null, loading: false });
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
}));
