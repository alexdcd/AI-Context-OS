import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { FileExplorer } from "../components/explorer/FileExplorer";
import { MemoryEditor } from "../components/editor/MemoryEditor";
import { useAppStore } from "../lib/store";
import { createMemory } from "../lib/tauri";
import type { MemoryType } from "../lib/types";

export function ExplorerView() {
  const {
    initialized,
    initialize,
    loadFileTree,
    loadMemories,
    regenerateRouter,
    memories,
  } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newType, setNewType] = useState<MemoryType>("context");
  const [newL0, setNewL0] = useState("");

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  // Keyboard shortcut: Cmd/Ctrl+N for new memory
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setShowCreate(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleCreate = async () => {
    if (!newId.trim() || !newL0.trim()) return;
    try {
      await createMemory({
        id: newId.trim().toLowerCase().replace(/\s+/g, "-"),
        memory_type: newType,
        l0: newL0.trim(),
        importance: 0.5,
        tags: [],
        l1_content: "",
        l2_content: "",
      });
      await regenerateRouter();
      setShowCreate(false);
      setNewId("");
      setNewL0("");
    } catch (e) {
      console.error("Failed to create memory:", e);
    }
  };

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
    <div className="flex h-full gap-2 p-2">
      <aside className="obs-panel flex w-[320px] shrink-0 flex-col overflow-hidden">
        <div className="border-b border-[var(--border)] px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--text-1)]">
              Explorer
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowCreate((prev) => !prev)}
                className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)] transition-colors hover:border-sky-500/40 hover:text-[color:var(--text-0)]"
                title="Nueva memoria"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRegenerate}
                className="rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)] transition-colors hover:border-sky-500/40 hover:text-[color:var(--text-0)]"
                title="Regenerar router"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/75 px-2.5 py-1.5 text-xs text-[color:var(--text-2)]">
            {memories.length} memorias disponibles
          </div>
        </div>

        {showCreate && (
          <div className="space-y-2 border-b border-[var(--border)] bg-[color:var(--bg-1)]/65 p-3">
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="memory-id (ej: stack-tecnologico)"
              className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:border-sky-500/50 focus:outline-none"
            />
            <input
              type="text"
              value={newL0}
              onChange={(e) => setNewL0(e.target.value)}
              placeholder="Resumen L0..."
              className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] focus:border-sky-500/50 focus:outline-none"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as MemoryType)}
              className="w-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-1)]"
            >
              <option value="context">Context</option>
              <option value="intelligence">Intelligence</option>
              <option value="project">Project</option>
              <option value="resource">Resource</option>
              <option value="skill">Skill</option>
              <option value="daily">Daily</option>
              <option value="task">Task</option>
              <option value="rule">Rule</option>
              <option value="scratch">Scratch</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs font-medium text-[color:var(--text-1)] transition-colors hover:bg-[color:var(--bg-2)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newId.trim() || !newL0.trim()}
                className="flex-1 rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-[color:var(--bg-3)] disabled:text-[color:var(--text-2)]"
              >
                Create
              </button>
            </div>
            <p className="text-[11px] text-[color:var(--text-2)]">
              Cmd/Ctrl + N abre este formulario.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 px-2 pb-2 pt-1">
          <div className="h-full rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/60">
            <FileExplorer />
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <MemoryEditor />
      </section>
    </div>
  );
}
