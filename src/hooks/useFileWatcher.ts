import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, wasRecentlyWrittenLocally } from "../lib/store";

/** Listen to Tauri events from the Rust file watcher and refresh state. */
export function useFileWatcher() {
  const { loadFileTree, loadMemories, loadGraph, regenerateRouter } = useAppStore();

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
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [loadFileTree, loadGraph, loadMemories, regenerateRouter]);
}
