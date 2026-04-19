import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, wasRecentlyWrittenLocally } from "../lib/store";
import type { CascadeRewriteOutcome } from "../lib/types";

/** Listen to Tauri events from the Rust file watcher and refresh state. */
export function useFileWatcher() {
  const { loadFileTree, loadMemories, loadGraph, regenerateRouter, selectFile } =
    useAppStore();

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

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
          await loadMemories();
          await loadFileTree();
          await loadGraph();
        }
      });
      unlisteners.push(unlisten1);

      const unlisten2 = await listen("file-deleted", async () => {
        await regenerateRouter();
        await loadMemories();
        await loadFileTree();
        await loadGraph();
      });
      unlisteners.push(unlisten2);

      const unlisten3 = await listen("router-regenerated", async () => {
        await loadMemories();
        await loadFileTree();
        await loadGraph();
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
          await loadMemories();
          await loadFileTree();
          await loadGraph();
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
      unlisteners.forEach((fn) => fn());
    };
  }, [loadFileTree, loadGraph, loadMemories, regenerateRouter, selectFile]);
}
