import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VaultEntry } from "./types";
import { listVaults, addVault, removeVault, switchVault, renameVault } from "./tauri";

export type SwitchPhase = "idle" | "confirming" | "switching" | "error";

interface VaultStore {
  // Vault list
  vaults: VaultEntry[];
  activeVaultPath: string | null;

  // Switch state machine
  switchPhase: SwitchPhase;
  switchTarget: VaultEntry | null;
  switchLogs: string[];
  switchError: string | null;

  // UI
  popoverOpen: boolean;

  // Actions
  loadVaults: () => Promise<void>;
  requestSwitch: (vault: VaultEntry) => void;
  confirmSwitch: () => Promise<void>;
  cancelSwitch: () => void;
  addVaultAndSwitch: (path: string, name?: string) => Promise<void>;
  removeVault: (path: string) => Promise<void>;
  renameVault: (path: string, name: string) => Promise<void>;
  setPopoverOpen: (open: boolean) => void;
  appendLog: (line: string) => void;
  setActiveVaultPath: (path: string) => void;
}

export const useVaultStore = create<VaultStore>()(
  persist(
    (set, get) => ({
      vaults: [],
      activeVaultPath: null,
      switchPhase: "idle",
      switchTarget: null,
      switchLogs: [],
      switchError: null,
      popoverOpen: false,

      loadVaults: async () => {
        try {
          const vaults = await listVaults();
          set({ vaults });
        } catch {
          // Non-fatal: vaults list stays empty
        }
      },

      requestSwitch: (vault) => {
        set({ switchPhase: "confirming", switchTarget: vault, switchError: null });
      },

      confirmSwitch: async () => {
        const target = get().switchTarget;
        if (!target) return;

        set({ switchPhase: "switching", switchLogs: [] });

        // Client-side log sequence — cosmetic, runs in parallel with the actual command
        const logSteps = [
          { delay: 0,    text: `Initializing switch to ${target.name}...` },
          { delay: 300,  text: "Saving current vault state..." },
          { delay: 700,  text: "Loading vault configuration..." },
          { delay: 1100, text: "Rebuilding memory index..." },
          { delay: 1600, text: "Binding file watcher..." },
          { delay: 2000, text: "Synchronizing router..." },
          { delay: 2400, text: "Almost there..." },
        ];

        const timers: ReturnType<typeof setTimeout>[] = [];
        logSteps.forEach(({ delay, text }) => {
          timers.push(setTimeout(() => get().appendLog(text), delay));
        });

        try {
          await switchVault(target.path);

          // Clear pending log timers and finalize
          timers.forEach(clearTimeout);
          get().appendLog(`✓ Switched to ${target.name}`);

          set({ activeVaultPath: target.path });

          // Short pause so user can read the final log, then reload app state
          await new Promise((r) => setTimeout(r, 600));

          // Reload app data (dynamic import to avoid circular dep)
          const { useAppStore } = await import("./store");
          useAppStore.getState().initialize();

          // Refresh vault list
          await get().loadVaults();

          set({ switchPhase: "idle", switchTarget: null });
        } catch (e) {
          timers.forEach(clearTimeout);
          set({ switchPhase: "error", switchError: String(e) });
        }
      },

      cancelSwitch: () => {
        set({ switchPhase: "idle", switchTarget: null, switchError: null });
      },

      addVaultAndSwitch: async (path, name) => {
        await addVault(path, name);
        const vaults = await listVaults();
        const entry = vaults.find((v) => v.path === path || v.path.endsWith(path));
        if (entry) {
          set({ vaults });
          get().requestSwitch(entry);
        }
      },

      removeVault: async (path) => {
        await removeVault(path);
        await get().loadVaults();
      },

      renameVault: async (path, name) => {
        await renameVault(path, name);
        await get().loadVaults();
      },

      setPopoverOpen: (open) => set({ popoverOpen: open }),

      appendLog: (line) =>
        set((s) => ({ switchLogs: [...s.switchLogs, line] })),

      setActiveVaultPath: (path) => set({ activeVaultPath: path }),
    }),
    {
      name: "obs-vaults",
      // Only persist the active vault path — list is always fresh from backend
      partialize: (s) => ({ activeVaultPath: s.activeVaultPath }),
    }
  )
);
