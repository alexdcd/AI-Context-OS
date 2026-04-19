import { useState, useEffect } from "react";
import { Search, Zap, Copy, Check, Clock, Trash2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getConfig, simulateContext } from "../lib/tauri";
import type { ScoredMemory } from "../lib/types";
import { MEMORY_ONTOLOGY_COLORS } from "../lib/types";
import { useAppStore } from "../lib/store";
import { useVaultStore } from "../lib/vaultStore";

const HISTORY_KEY = "simulation_history";
const MAX_HISTORY = 8;

interface SimulationRun {
  id: string;
  query: string;
  budget: number;
  timestamp: number;
  results: ScoredMemory[];
}

function loadHistory(): SimulationRun[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(runs: SimulationRun[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(runs.slice(0, MAX_HISTORY)));
}

export function SimulationView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const indexedMemories = useAppStore((state) => state.memories.length);
  const selectFile = useAppStore((state) => state.selectFile);
  const activeVaultPath = useVaultStore((state) => state.activeVaultPath);
  const [query, setQuery] = useState("");
  const [budget, setBudget] = useState(4000);
  const [results, setResults] = useState<ScoredMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasSimulated, setHasSimulated] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  const [history, setHistory] = useState<SimulationRun[]>(loadHistory);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  const timeAgo = (ts: number): string => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return t("simulation.justNow");
    const m = Math.floor(s / 60);
    if (m < 60) return t("simulation.minutesAgo", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("simulation.hoursAgo", { count: h });
    return t("simulation.daysAgo", { count: Math.floor(h / 24) });
  };

  // Keep history in sync with localStorage
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    getConfig()
      .then((config) => setVaultRoot(config.root_dir))
      .catch(() => setVaultRoot(null));
  }, []);

  useEffect(() => {
    if (activeVaultPath) {
      setVaultRoot(activeVaultPath);
    }
  }, [activeVaultPath]);

  const handleSimulate = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setRunError(null);
    try {
      const normalizedQuery = query.trim();
      const scored = await simulateContext(normalizedQuery, budget);
      setResults(scored);
      setHasSimulated(true);
      setActiveHistoryId(null);

      const run: SimulationRun = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        query: normalizedQuery,
        budget,
        timestamp: Date.now(),
        results: scored,
      };
      setHistory((prev) => [run, ...prev.filter((r) => r.query !== normalizedQuery).slice(0, MAX_HISTORY - 1)]);
    } catch (e) {
      console.error("Simulation failed:", e);
      const message =
        typeof e === "string"
          ? e
          : e instanceof Error
            ? e.message
            : JSON.stringify(e);
      setResults([]);
      setRunError(message);
      setHasSimulated(true);
    } finally {
      setLoading(false);
    }
  };

  const loadRun = (run: SimulationRun) => {
    setQuery(run.query);
    setBudget(run.budget);
    setResults(run.results);
    setRunError(null);
    setHasSimulated(true);
    setActiveHistoryId(run.id);
  };

  const clearHistory = () => {
    setHistory([]);
    setActiveHistoryId(null);
  };

  const openMemory = async (memoryId: string) => {
    await selectFile(memoryId);
    navigate("/");
  };

  const totalTokens = results.reduce((acc, r) => acc + r.token_estimate, 0);
  const budgetRatio = totalTokens / budget;

  return (
    <div className="flex h-full min-h-0">
      {/* History sidebar */}
      {history.length > 0 && (
        <div className="flex w-52 shrink-0 flex-col border-r border-[var(--border)]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--text-2)]">
              <Clock className="h-3 w-3" />
              {t("simulation.history")}
            </span>
            <button
              onClick={clearHistory}
              title={t("simulation.clearHistory")}
              className="rounded p-0.5 text-[color:var(--text-2)] hover:text-[color:var(--danger)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {history.map((run) => {
              const runTokens = run.results.reduce((a, r) => a + r.token_estimate, 0);
              const isActive = run.id === activeHistoryId;
              return (
                <button
                  key={run.id}
                  onClick={() => loadRun(run)}
                  className={`w-full px-3 py-2 text-left transition-colors hover:bg-[color:var(--bg-2)] ${
                    isActive ? "bg-[color:var(--bg-2)] border-l-2 border-[color:var(--accent)]" : ""
                  }`}
                >
                  <p className="truncate text-[11px] text-[color:var(--text-1)] font-medium">
                    {run.query}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[color:var(--text-2)]">
                    {t("simulation.memoriesTokens", { count: run.results.length, tokens: runTokens })}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[color:var(--text-2)]">
                    {timeAgo(run.timestamp)}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main panel */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Query bar */}
        <div className="border-b border-[var(--border)] px-4 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSimulate()}
              placeholder={t("simulation.queryPlaceholder")}
              className="flex-1 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-1.5 text-sm text-[color:var(--text-0)] placeholder:text-[color:var(--text-2)]"
            />
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(parseInt(e.target.value) || 4000)}
              className="w-20 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1.5 text-center text-xs text-[color:var(--text-1)]"
              title={t("simulation.tokenBudget")}
            />
            <button
              onClick={handleSimulate}
              disabled={!query.trim() || loading}
              className="flex items-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <Search className="h-3.5 w-3.5" />
              {loading ? t("simulation.running") : t("simulation.simulate")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--text-2)]">
            <span>{t("simulation.activeVaultStatus", { count: indexedMemories })}</span>
            {vaultRoot && (
              <span className="max-w-full truncate rounded border border-[var(--border)] px-1.5 py-0.5 font-mono">
                {vaultRoot}
              </span>
            )}
          </div>
          {/* Example queries — shown when no results yet */}
          {results.length === 0 && !loading && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["debug memory leak", "plan next sprint", "API authentication", "summarize decisions"].map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); }}
                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--text-2)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Budget bar */}
        {results.length > 0 && (
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2">
            {activeHistoryId && (
              <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[color:var(--text-2)]">
                {t("simulation.fromHistory")}
              </span>
            )}
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
              {t("simulation.totalLoaded", { tokens: totalTokens, budget, count: results.length })}
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
              title={t("simulation.copyTooltip")}
            >
              {copied ? <Check className="h-3 w-3 text-[color:var(--success)]" /> : <Copy className="h-3 w-3" />}
              {copied ? t("simulation.copied") : t("simulation.copy")}
            </button>
          </div>
        )}

        {/* Score legend */}
        {results.length > 0 && (
          <div className="flex gap-3 border-b border-[var(--border)] px-4 py-1.5">
            {[
              { label: t("simulation.semantic"), color: "#8b5cf6" },
              { label: t("simulation.bm25"), color: "#3b82f6" },
              { label: t("simulation.recency"), color: "#22c55e" },
              { label: t("simulation.importance"), color: "#f59e0b" },
              { label: t("simulation.frequency"), color: "#ec4899" },
              { label: t("simulation.graph"), color: "#06b6d4" },
            ].map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1 text-[10px] text-[color:var(--text-2)]">
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color, opacity: 0.75 }} />
                {label}
              </span>
            ))}
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
                    backgroundColor: MEMORY_ONTOLOGY_COLORS[r.ontology] + "18",
                    color: MEMORY_ONTOLOGY_COLORS[r.ontology],
                  }}
                >
                  {t(`ontologies.${r.ontology}`)}
                </span>
                <span className="rounded border border-[var(--border)] px-1 py-0.5 font-mono text-[10px] text-[color:var(--text-2)]">
                  {r.load_level.toUpperCase()}
                </span>
                <button
                  onClick={() => void openMemory(r.memory_id)}
                  className="shrink-0 rounded px-1 py-0.5 font-mono text-[11px] text-[color:var(--accent)] hover:bg-[color:var(--bg-2)] hover:underline"
                  title={r.memory_id}
                >
                  {r.memory_id}
                </button>
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
                <ScoreBar value={r.score.semantic} color="#8b5cf6" label={t("simulation.semantic")} weight={0.3} />
                <ScoreBar value={r.score.bm25} color="#3b82f6" label={t("simulation.bm25")} weight={0.15} />
                <ScoreBar value={r.score.recency} color="#22c55e" label={t("simulation.recency")} weight={0.15} />
                <ScoreBar value={r.score.importance} color="#f59e0b" label={t("simulation.importance")} weight={0.2} />
                <ScoreBar value={r.score.access_frequency} color="#ec4899" label={t("simulation.frequency")} weight={0.1} />
                <ScoreBar value={r.score.graph_proximity} color="#06b6d4" label={t("simulation.graph")} weight={0.1} />
              </div>
            </div>
          ))}
          {results.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-[color:var(--text-2)]">
              {runError ? (
                <>
                  <AlertCircle className="mb-3 h-8 w-8 text-[color:var(--danger)]" />
                  <p className="text-sm font-medium text-[color:var(--text-1)]">
                    {t("simulation.errorTitle")}
                  </p>
                  <p className="mt-1 max-w-xl text-center text-xs">
                    {t("simulation.errorBody")}
                  </p>
                  <p className="mt-3 max-w-2xl break-all rounded-md border border-[color:var(--danger)]/30 bg-[color:var(--bg-2)] px-3 py-2 text-left font-mono text-[11px] text-[color:var(--text-1)]">
                    {runError}
                  </p>
                </>
              ) : hasSimulated ? (
                <>
                  <Search className="mb-3 h-8 w-8" />
                  <p className="text-sm font-medium text-[color:var(--text-1)]">
                    {t("simulation.emptyTitle")}
                  </p>
                  <p className="mt-1 max-w-xl text-center text-xs">
                    {indexedMemories === 0
                      ? t("simulation.emptyVaultHint")
                      : t("simulation.emptyBody", { query, budget })}
                  </p>
                </>
              ) : (
                <>
                  <Zap className="mb-3 h-8 w-8" />
                  <p className="text-xs">{t("simulation.noResults")}</p>
                </>
              )}
            </div>
          )}
        </div>
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
