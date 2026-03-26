import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "../../lib/types";

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const memories = useAppStore((s) => s.memories);
  const selectFile = useAppStore((s) => s.selectFile);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return memories.slice(0, 20);
    const q = query.toLowerCase();
    return memories
      .filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.l0.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .slice(0, 20);
  }, [query, memories]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  const handleSelect = async (id: string) => {
    onClose();
    await selectFile(id);
    navigate("/");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      e.preventDefault();
      void handleSelect(results[selectedIdx].id);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-[color:var(--text-2)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar memorias por id, descripción o tags..."
            className="flex-1 bg-transparent text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)] outline-none"
          />
          <button onClick={onClose} className="text-[color:var(--text-2)] hover:text-[color:var(--text-1)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-1">
          {results.map((m, i) => (
            <button
              key={m.id}
              onClick={() => void handleSelect(m.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                i === selectedIdx
                  ? "bg-[color:var(--accent-muted)] text-[color:var(--text-0)]"
                  : "text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]"
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: MEMORY_TYPE_COLORS[m.memory_type] }}
              />
              <span className="flex-1 truncate text-xs font-medium">{m.id}</span>
              <span className="max-w-[180px] truncate text-[10px] text-[color:var(--text-2)]">{m.l0}</span>
              <span className="shrink-0 text-[10px] text-[color:var(--text-2)]">
                {MEMORY_TYPE_LABELS[m.memory_type]}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-[color:var(--text-2)]">Sin resultados</p>
          )}
        </div>
        <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[color:var(--text-2)]">
          ↑↓ navegar · Enter abrir · Esc cerrar
        </div>
      </div>
    </div>
  );
}
