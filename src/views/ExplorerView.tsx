import { lazy, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { FileExplorer } from "../components/explorer/FileExplorer";
import { useAppStore } from "../lib/store";
import { createMemory } from "../lib/tauri";
import type { MemoryType } from "../lib/types";
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
    isCreateMemoryOpen,
    setCreateMemoryOpen,
  } = useAppStore();
  const expertModeEnabled = useSettingsStore((s) => s.expertModeEnabled);
  const showSystemFiles = useSettingsStore((s) => s.showSystemFiles);
  const toggleShowSystemFiles = useSettingsStore((s) => s.toggleShowSystemFiles);
  const [newId, setNewId] = useState("");
  const [newType, setNewType] = useState<MemoryType>("context");
  const [newL0, setNewL0] = useState("");
  const [newIdTouched, setNewIdTouched] = useState(false);

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setCreateMemoryOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!isCreateMemoryOpen) {
      setNewIdTouched(false);
      return;
    }
    if (!newIdTouched) {
      setNewId(normalizeMemoryId(newL0));
    }
  }, [isCreateMemoryOpen, newIdTouched, newL0]);

  const handleCreate = async () => {
    const l0 = newL0.trim();
    const nextId = normalizeMemoryId(newId || l0);
    if (!nextId || !l0) return;
    try {
      await createMemory({
        id: nextId,
        memory_type: newType,
        l0,
        importance: 0.5,
        tags: [],
        l1_content: "",
        l2_content: "",
      });
      await regenerateRouter();
      setCreateMemoryOpen(false);
      setNewId("");
      setNewL0("");
      setNewIdTouched(false);
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
    <div className="flex h-full">
      {explorerOpen && (
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[color:var(--bg-0)] transition-all duration-300">
        <div className="flex shrink-0 h-[38px] items-center justify-between px-3 border-b border-[var(--border)]">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
            Memorias
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
                title={showSystemFiles ? "Ocultar archivos del sistema" : "Mostrar archivos del sistema"}
              >
                {showSystemFiles ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={() => setCreateMemoryOpen(!isCreateMemoryOpen)}
              className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              title="Nueva memoria (Cmd+N)"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleRegenerate}
              className="rounded p-1 text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              title="Regenerar router"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {isCreateMemoryOpen && (
          <div className="space-y-2 border-b border-[var(--border)] px-3 py-2.5 bg-[color:var(--bg-1)]">
            <input
              type="text"
              value={newId}
              onChange={(e) => {
                setNewIdTouched(true);
                setNewId(normalizeMemoryId(e.target.value));
              }}
              placeholder="memory-id"
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
            />
            <input
              type="text"
              value={newL0}
              onChange={(e) => setNewL0(e.target.value)}
              placeholder="Resumen (L0)"
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as MemoryType)}
              className="w-full rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1.5 text-xs text-[color:var(--text-1)]"
            >
              <option value="context">Contexto</option>
              <option value="intelligence">Inteligencia</option>
              <option value="project">Proyecto</option>
              <option value="resource">Recurso</option>
              <option value="skill">Skill</option>
              <option value="daily">Diario</option>
              <option value="task">Tarea</option>
              <option value="rule">Regla</option>
              <option value="scratch">Scratch</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setCreateMemoryOpen(false)}
                className="flex-1 rounded-md border border-[var(--border)] py-1.5 text-xs text-[color:var(--text-2)] transition-colors hover:bg-[color:var(--bg-2)] hover:text-[color:var(--text-1)]"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={!newId.trim() || !newL0.trim()}
                className={clsx(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition-opacity",
                  normalizeMemoryId(newId || newL0) && newL0.trim()
                    ? "bg-[color:var(--accent)] text-white hover:opacity-90"
                    : "bg-[color:var(--bg-3)] text-[color:var(--text-2)] opacity-50",
                )}
              >
                Crear
              </button>
            </div>
          </div>
        )}

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

function normalizeMemoryId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function EditorFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[color:var(--text-2)]">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--text-2)] border-t-transparent" />
    </div>
  );
}
