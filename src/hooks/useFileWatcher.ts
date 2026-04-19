import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, wasRecentlyWrittenLocally } from "../lib/store";
import type { CascadeRewriteOutcome } from "../lib/types";

const WATCHER_REFRESH_DEBOUNCE_MS = 120;

/** Listen to Tauri events from the Rust file watcher and refresh state. */
export function useFileWatcher() {
  const loadFileTree = useAppStore((state) => state.loadFileTree);
  const loadMemories = useAppStore((state) => state.loadMemories);
  const loadGraph = useAppStore((state) => state.loadGraph);
  const regenerateRouter = useAppStore((state) => state.regenerateRouter);
  const selectFile = useAppStore((state) => state.selectFile);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshQueued = false;
    let queuedGraphRefresh = false;

    const shouldRefreshGraph = () => window.location.pathname === "/graph";
    const refreshWorkspaceState = async (includeGraph: boolean) => {
      if (refreshInFlight) {
        refreshQueued = true;
        queuedGraphRefresh = queuedGraphRefresh || includeGraph;
        return;
      }

      refreshInFlight = true;
      let refreshGraph = includeGraph;

      try {
        while (true) {
          await loadMemories();
          await loadFileTree();
          if (refreshGraph && shouldRefreshGraph()) {
            await loadGraph();
          }

          if (!refreshQueued) {
            break;
          }

          refreshGraph = refreshGraph || queuedGraphRefresh;
          refreshQueued = false;
          queuedGraphRefresh = false;
        }
      } finally {
        refreshInFlight = false;
      }
    };

    const scheduleRefresh = (includeGraph: boolean) => {
      queuedGraphRefresh = queuedGraphRefresh || includeGraph;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        const includeGraph = queuedGraphRefresh;
        queuedGraphRefresh = false;
        void refreshWorkspaceState(includeGraph);
      }, WATCHER_REFRESH_DEBOUNCE_MS);
    };

    const setup = async () => {
      const unlisten1 = await listen<string>("memory-changed", async (event) => {
        const payload = event.payload ?? "";
        const looksLikePath = payload.includes("/") || payload.includes("\\");
        if (looksLikePath) {
          if (wasRecentlyWrittenLocally(payload)) {
            return;
          }
          // External filesystem edit: keep router/index in sync with frontmatter changes.
          await regenerateRouter();
        }
      });
      unlisteners.push(unlisten1);

      const unlisten2 = await listen("file-deleted", async () => {
        await regenerateRouter();
      });
      unlisteners.push(unlisten2);

      const unlisten3 = await listen("router-regenerated", async () => {
        scheduleRefresh(true);
      });
      unlisteners.push(unlisten3);

      // Backend emits this after an id-rename cascade rewrites `[[old_id]]`
      // references in other canonical memories. The recent-write debounce
      // hides the underlying file events from the watcher, so refresh
      // derived state explicitly here.
      const unlisten4 = await listen<CascadeRewriteOutcome>(
        "wikilinks-cascade",
        async (event) => {
          const outcome = event.payload;
          await refreshWorkspaceState(true);
          // Re-fetch the currently open memory if it was rewritten by the
          // cascade — the in-memory body is stale.
          const active = useAppStore.getState().activeMemory;
          if (active && outcome?.affected_ids?.includes(active.meta.id)) {
            await selectFile(active.meta.id);
          }
        },
      );
      unlisteners.push(unlisten4);
    };

    setup();

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      unlisteners.forEach((fn) => fn());
    };
  }, [loadFileTree, loadGraph, loadMemories, regenerateRouter, selectFile]);
}
