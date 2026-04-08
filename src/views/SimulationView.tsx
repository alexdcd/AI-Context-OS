import { useState } from "react";
import { Search, Zap, Copy, Check } from "lucide-react";
import { simulateContext } from "../lib/tauri";
import type { ScoredMemory } from "../lib/types";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "../lib/types";

export function SimulationView() {
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState(4000);
  const [results, setResults] = useState<ScoredMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSimulate = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const scored = await simulateContext(query, budget);
      setResults(scored);
    } catch (e) {
      console.error("Simulation failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const totalTokens = results.reduce((acc, r) => acc + r.token_estimate, 0);
  const budgetRatio = totalTokens / budget;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Query bar */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
            placeholder="Query to simulate context loading..."
            className="flex-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-1.5 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
          />
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(parseInt(e.target.value) || 4000)}
            className="w-20 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-center text-xs text-[color:var(--text-1)]"
            title="Token budget"
          />
          <button
            onClick={handleSimulate}
            disabled={!query.trim() || loading}
            className="flex items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <Search className="h-3.5 w-3.5" />
            Simulate
          </button>
        </div>
      </div>

      {/* Budget bar */}
      {results.length > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-3)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, budgetRatio * 100)}%`,
                backgroundColor:
                  budgetRatio > 0.9
                    ? "var(--danger)"
                    : budgetRatio > 0.7
                      ? "var(--warning)"
                      : "var(--success)",
              }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-[color:var(--text-2)]">
            {totalTokens}/{budget} tokens · {results.length} loaded
          </span>
          <button
            onClick={() => {
              const text = results
                .map((r) => `[${r.load_level.toUpperCase()}] ${r.memory_id}: ${r.l0} (score: ${r.score.final_score.toFixed(3)}, ${r.token_estimate}t)`)
                .join("\n");
              navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            title="Copy context to clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-[color:var(--success)]" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
        {results.map((r, idx) => (
          <div
            key={r.memory_id}
            className="rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] p-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 text-right font-mono text-[11px] text-[color:var(--text-2)]">
                {idx + 1}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: MEMORY_TYPE_COLORS[r.memory_type] + "18",
                  color: MEMORY_TYPE_COLORS[r.memory_type],
                }}
              >
                {MEMORY_TYPE_LABELS[r.memory_type]}
              </span>
              <span className="rounded border border-[var(--border)] px-1 py-0.5 font-mono text-[10px] text-[color:var(--text-2)]">
                {r.load_level.toUpperCase()}
              </span>
              <span className="flex-1 truncate text-xs text-[color:var(--text-1)]">
                {r.l0}
              </span>
              <span className="font-mono text-[11px] text-[color:var(--text-2)]">
                {r.token_estimate}t
              </span>
              <span className="font-mono text-xs text-[color:var(--accent)]">
                {r.score.final_score.toFixed(3)}
              </span>
            </div>
            <div className="flex gap-0.5 h-1">
              <ScoreBar value={r.score.semantic} color="#8b5cf6" label="Semantic" weight={0.3} />
              <ScoreBar value={r.score.bm25} color="#3b82f6" label="BM25" weight={0.15} />
              <ScoreBar value={r.score.recency} color="#22c55e" label="Recency" weight={0.15} />
              <ScoreBar value={r.score.importance} color="#f59e0b" label="Importance" weight={0.2} />
              <ScoreBar value={r.score.access_frequency} color="#ec4899" label="Frequency" weight={0.1} />
              <ScoreBar value={r.score.graph_proximity} color="#06b6d4" label="Graph" weight={0.1} />
            </div>
          </div>
        ))}
        {results.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-[color:var(--text-2)]">
            <Zap className="mb-3 h-8 w-8" />
            <p className="text-xs">
              Type a query and simulate to see which memories would load.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({
  value,
  color,
  label,
  weight,
}: {
  value: number;
  color: string;
  label: string;
  weight: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-full bg-[color:var(--bg-3)]"
      style={{ flex: weight * 100 }}
      title={`${label}: ${value.toFixed(3)} (×${weight})`}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${value * 100}%`,
          backgroundColor: color,
          opacity: 0.75,
        }}
      />
    </div>
  );
}
