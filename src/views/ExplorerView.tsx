import { lazy, Suspense, useEffect } from "react";
import { Eye, EyeOff, FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { FileExplorer } from "../components/explorer/FileExplorer";
import { useAppStore } from "../lib/store";
import { useSettingsStore } from "../lib/settingsStore";

const MemoryEditor = lazy(() =>
  import("../components/editor/MemoryEditor").then((module) => ({
    default: module.MemoryEditor,
  })),
);

export function ExplorerView() {
  const {
    initialized,
    initialize,
    loadFileTree,
    loadMemories,
    regenerateRouter,
    memories,
    explorerOpen,
    setPendingCreate,
  } = useAppStore();
  const expertModeEnabled = useSettingsStore((s) => s.expertModeEnabled);
  const showSystemFiles = useSettingsStore((s) => s.showSystemFiles);
  const toggleShowSystemFiles = useSettingsStore((s) => s.toggleShowSystemFiles);

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setPendingCreate("file");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setPendingCreate]);

  const handleRegenerate = async () => {
    try {
      await regenerateRouter();
      await loadFileTree();
      await loadMemories();
    } catch (e) {
      console.error("Failed to regenerate:", e);
    }
  };

  return (
    <div className="flex h-full">
      {explorerOpen && (
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[color:var(--bg-0)] transition-all duration-300">
        <div className="flex shrink-0 h-[38px] items-center justify-between px-3 border-b border-[var(--border)]">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
            Memories
            <span className="ml-1.5 font-normal tabular-nums">{memories.length}</span>
          </span>
          <div className="flex gap-0.5">
            {expertModeEnabled && (
              <button
                onClick={toggleShowSystemFiles}
                className={clsx(
                  "rounded p-1 transition-colors",
                  showSystemFiles
                    ? "text-[color:var(--accent)] hover:bg-[color:var(--accent-muted)]"
                    : "text-[color:var(--text-2)] hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
                )}
                title={showSystemFiles ? "Hide system files" : "Show system files"}
              >
                {showSystemFiles ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={() => setPendingCreate("file")}
              className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              title="New note (Cmd+N)"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setPendingCreate("folder")}
              className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              title="New folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleRegenerate}
              className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              title="Regenerate router"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileExplorer />
        </div>
      </aside>
      )}

      <section className="min-w-0 flex-1 bg-[color:var(--bg-1)]">
        <Suspense fallback={<EditorFallback />}>
          <MemoryEditor />
        </Suspense>
      </section>
    </div>
  );
}

function EditorFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[color:var(--text-2)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--text-2)] border-t-transparent" />
    </div>
  );
}
