import { useEffect, useState, useRef } from "react";
import {
  Activity,
  BarChart3,
  Zap,
  Check,
  X,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getRecentContextRequests,
  getObservabilityStats,
  getTopMemoriesStats,
  getUnusedMemoriesStats,
  getPendingOptimizations,
  applyOptimization,
  dismissOptimization,
  runOptimizationAnalysis,
  getHealthScore,
  getHealthHistory,
} from "../lib/tauri";
import type {
  ContextRequestRecord,
  ObservabilityStats,
  TopMemoryRecord,
  UnusedMemoryRecord,
  OptimizationRecord,
  HealthScore,
  HealthScoreSnapshot,
} from "../lib/types";

type Tab = "live" | "intelligence" | "optimizations";

// ─── Health Banner ───

const DIMENSION_INFO: Record<string, { label: string; description: string; needsUsage: boolean }> = {
  coverage:    { label: "Coverage",    description: "% of memories ever surfaced by the router",        needsUsage: true },
  efficiency:  { label: "Efficiency",  description: "How well loaded memories match actual queries",    needsUsage: true },
  freshness:   { label: "Freshness",   description: "Recency of memory access patterns",                needsUsage: false },
  balance:     { label: "Balance",     description: "Distribution across ontology types",               needsUsage: true },
  cleanliness: { label: "Cleanliness", description: "Absence of expired scratch / decay candidates",    needsUsage: false },
};

interface HealthBannerProps {
  health: HealthScore | null;
  history: HealthScoreSnapshot[];
  hasUsageData: boolean;
  highImpactCount: number;
  onNavigateToOptimizations: () => void;
}

function HealthBanner({ health, history, hasUsageData, highImpactCount, onNavigateToOptimizations }: HealthBannerProps) {
  if (!health) return null;

  const score = Math.round(health.score);
  const isHealthy = score >= 80;
  const isWarning = score >= 60 && score < 80;

  const color = isHealthy
    ? "var(--success, #10b981)"
    : isWarning
      ? "#f59e0b"
      : "var(--danger, #ef4444)";

  const label = isHealthy ? "Healthy" : isWarning ? "Needs attention" : "Action required";

  const trend =
    history.length >= 2 ? history[0].score - history[1].score : null;

  return (
    <div
      className="card"
      style={{
        padding: "14px 16px",
        marginBottom: 16,
        borderLeft: `3px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Top row: score + label + CTA */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: `3px solid ${color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color }}>{score}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color }}>{label}</span>
            {trend !== null && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: 11,
                  color: trend > 0 ? "#10b981" : trend < 0 ? "#ef4444" : "var(--text-2)",
                }}
              >
                {trend > 0 ? <TrendingUp size={12} /> : trend < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
                {trend > 0 ? "+" : ""}{trend.toFixed(0)} vs yesterday
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: "var(--text-2)", margin: 0 }}>
            {!hasUsageData
              ? "Some scores need usage data — connect an AI tool and send a few requests to calibrate."
              : health.summary}
          </p>
        </div>

        {/* CTA: only show when there are high-impact optimizations pending */}
        {highImpactCount > 0 && (
          <button
            onClick={onNavigateToOptimizations}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--danger, #ef4444)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            Fix {highImpactCount} issue{highImpactCount > 1 ? "s" : ""}
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      {/* Breakdown bars */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {Object.entries(DIMENSION_INFO).map(([key, { label, description, needsUsage }]) => {
          const noData = needsUsage && !hasUsageData;
          const val = Math.round(health.breakdown[key as keyof typeof health.breakdown]);
          const barColor = val >= 80 ? "#10b981" : val >= 60 ? "#f59e0b" : "#ef4444";

          return (
            <div key={key} title={description} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-2)" }}>
                <span>{label}</span>
                <span style={{ color: noData ? "var(--text-2)" : barColor, fontWeight: 600 }}>
                  {noData ? "—" : val}
                </span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "var(--bg-3)", overflow: "hidden" }}>
                {noData ? (
                  /* striped pattern for no-data state */
                  <div style={{ height: "100%", background: "repeating-linear-gradient(90deg, var(--bg-3) 0px, var(--bg-3) 4px, var(--border) 4px, var(--border) 8px)" }} />
                ) : (
                  <div
                    style={{
                      width: `${val}%`,
                      height: "100%",
                      borderRadius: 2,
                      background: barColor,
                      transition: "width 0.5s ease",
                    }}
                  />
                )}
              </div>
              <span style={{ fontSize: 9, color: "var(--text-2)", lineHeight: 1.3 }}>
                {noData ? "needs usage data" : description}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main View ───

export function ObservabilityView() {
  const [activeTab, setActiveTab] = useState<Tab>("live");
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [history, setHistory] = useState<HealthScoreSnapshot[]>([]);
  const [hasUsageData, setHasUsageData] = useState(true);
  const [highImpactCount, setHighImpactCount] = useState(0);

  useEffect(() => {
    Promise.all([
      getHealthScore(),
      getHealthHistory(7),
      getObservabilityStats(7),
      getPendingOptimizations(),
    ]).then(([h, hist, stats, opts]) => {
      setHealth(h);
      setHistory(hist);
      setHasUsageData((stats.requests_this_week + stats.requests_prev_week) > 0);
      setHighImpactCount(opts.filter((o) => o.impact === "high").length);
    }).catch(console.error);
  }, []);

  const tabs: { id: Tab; icon: typeof Activity; label: string }[] = [
    { id: "live", icon: Activity, label: "Live" },
    { id: "intelligence", icon: BarChart3, label: "Intelligence" },
    { id: "optimizations", icon: Zap, label: "Optimizations" },
  ];

  return (
    <div className="view-container h-full overflow-y-auto" style={{ padding: 24 }}>
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--text-2)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 16,
          margin: "0 0 16px",
        }}
      >
        Observability
      </h2>

      <HealthBanner
        health={health}
        history={history}
        hasUsageData={hasUsageData}
        highImpactCount={highImpactCount}
        onNavigateToOptimizations={() => setActiveTab("optimizations")}
      />

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx("tab-button", activeTab === tab.id && "tab-active")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === tab.id ? "var(--text-0)" : "var(--text-2)",
              cursor: "pointer",
            }}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "live" && <LiveTab />}
      {activeTab === "intelligence" && <IntelligenceTab />}
      {activeTab === "optimizations" && <OptimizationsTab />}
    </div>
  );
}

// ─── Live Tab ───

function LiveTab() {
  const [requests, setRequests] = useState<ContextRequestRecord[]>([]);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastLoadRef = useRef<number>(Date.now());

  const loadRequests = () => {
    getRecentContextRequests(20)
      .then((data) => {
        setRequests(data);
        lastLoadRef.current = Date.now();
        setSecondsAgo(0);
      })
      .catch(console.error);
  };

  useEffect(() => {
    loadRequests();
    const poll = setInterval(loadRequests, 5000);
    return () => clearInterval(poll);
  }, []);

  // Tick the "updated X sec ago" counter every second
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastLoadRef.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const last = requests[0];
  const updatedLabel =
    secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="live-dot" />
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          Live · updated {updatedLabel}
        </span>
      </div>

      {/* Last request card */}
      {last ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>Last request</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-0)", marginBottom: 8 }}>
            "{last.query}"
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-1)" }}>
            <span>Source: {last.source}</span>
            <span>Type: {last.task_type}</span>
            <span>{new Date(last.timestamp).toLocaleString()}</span>
          </div>
          {/* Token bar */}
          <div style={{ marginTop: 8, background: "var(--bg-2)", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min((last.tokens_used / last.token_budget) * 100, 100)}%`,
                height: "100%",
                background: "var(--accent)",
                borderRadius: 4,
                transition: "width 0.3s",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
            {last.tokens_used} / {last.token_budget} tokens · {last.memories_loaded} memories loaded
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>
          No context requests yet. Connect an AI tool to get started.
        </div>
      )}

      {/* History */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
          Request history
        </h3>
        {requests.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: 12 }}>No history</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {requests.map((req) => (
              <div
                key={req.id}
                className="card"
                style={{
                  padding: "8px 12px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                }}
              >
                <div style={{ flex: 1, color: "var(--text-0)", fontWeight: 500 }}>
                  {req.query.length > 60 ? req.query.slice(0, 60) + "…" : req.query}
                </div>
                <div style={{ display: "flex", gap: 12, color: "var(--text-2)", fontSize: 11, flexShrink: 0 }}>
                  <span>{req.tokens_used}t</span>
                  <span>{req.memories_loaded}m</span>
                  <span>{req.source}</span>
                  <span>{new Date(req.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Intelligence Tab ───

function IntelligenceTab() {
  const [stats, setStats] = useState<ObservabilityStats | null>(null);
  const [topMemories, setTopMemories] = useState<TopMemoryRecord[]>([]);
  const [unusedMemories, setUnusedMemories] = useState<UnusedMemoryRecord[]>([]);

  useEffect(() => {
    getObservabilityStats(7).then(setStats).catch(console.error);
    getTopMemoriesStats(10, 30).then(setTopMemories).catch(console.error);
    getUnusedMemoriesStats(30).then(setUnusedMemories).catch(console.error);
  }, []);

  const requestTrend = stats ? stats.requests_this_week - stats.requests_prev_week : 0;
  const efficiencyLevel =
    !stats ? null
    : stats.efficiency_percent >= 80 ? "up"
    : stats.efficiency_percent >= 60 ? "neutral"
    : "down";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stat cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <StatCard
            label="Requests/week"
            value={stats.requests_this_week}
            delta={requestTrend}
          />
          <StatCard label="Tokens served" value={stats.tokens_served_total} />
          <StatCard label="Active memories" value={`${stats.active_memories}/${stats.total_memories}`} />
          <StatCard label="Efficiency" value={`${stats.efficiency_percent.toFixed(0)}%`} trend={efficiencyLevel} />
        </div>
      )}

      {/* Efficiency trend explainer */}
      {stats && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--text-1)",
          }}
        >
          {efficiencyLevel === "up" && <TrendingUp size={14} color="#10b981" />}
          {efficiencyLevel === "neutral" && <Minus size={14} color="#f59e0b" />}
          {efficiencyLevel === "down" && <TrendingDown size={14} color="#ef4444" />}
          <span>
            {efficiencyLevel === "up" &&
              `Context efficiency is strong at ${stats.efficiency_percent.toFixed(0)}% — memories are well-calibrated for the queries coming in.`}
            {efficiencyLevel === "neutral" &&
              `Efficiency at ${stats.efficiency_percent.toFixed(0)}% — some memories may be loaded without matching query context.`}
            {efficiencyLevel === "down" &&
              `Efficiency low at ${stats.efficiency_percent.toFixed(0)}% — consider running an optimization analysis to recalibrate.`}
          </span>
        </div>
      )}

      {/* Top memories */}
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
          Top memories (30 days)
        </h3>
        {topMemories.length === 0 ? (
          <div style={{ color: "var(--text-2)", fontSize: 12 }}>Insufficient data</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {topMemories.map((mem) => (
              <div key={mem.memory_id} className="card" style={{ padding: "8px 12px", fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-0)" }}>{mem.memory_id}</span>
                  <span style={{ color: "var(--text-2)" }}>
                    {mem.times_served}x · {mem.typical_level} · {mem.pct_of_requests.toFixed(0)}%
                  </span>
                </div>
                <div style={{ marginTop: 4, background: "var(--bg-2)", borderRadius: 3, height: 4 }}>
                  <div
                    style={{
                      width: `${Math.min(mem.pct_of_requests, 100)}%`,
                      height: "100%",
                      background: "var(--accent)",
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unused memories */}
      {unusedMemories.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
            Unused memories ({unusedMemories.length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {unusedMemories.map((mem) => (
              <div
                key={mem.memory_id}
                className="card"
                style={{ padding: "8px 12px", fontSize: 12, display: "flex", justifyContent: "space-between" }}
              >
                <span style={{ color: "var(--text-0)" }}>{mem.memory_id}</span>
                <span style={{ color: "var(--text-2)" }}>
                  {mem.days_since_use} days unused
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  delta,
  trend,
}: {
  label: string;
  value: string | number;
  delta?: number;
  trend?: "up" | "neutral" | "down" | null;
}) {
  return (
    <div className="card" style={{ padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-0)" }}>{value}</div>
      {delta !== undefined && delta !== 0 && (
        <div style={{ fontSize: 11, color: delta > 0 ? "#10b981" : "#ef4444", marginTop: 2 }}>
          {delta > 0 ? "+" : ""}{delta} vs last week
        </div>
      )}
      {trend && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
          {trend === "up" && <TrendingUp size={12} color="#10b981" />}
          {trend === "neutral" && <Minus size={12} color="#f59e0b" />}
          {trend === "down" && <TrendingDown size={12} color="#ef4444" />}
        </div>
      )}
    </div>
  );
}

// ─── Optimizations Tab ───

function OptimizationsTab() {
  const [optimizations, setOptimizations] = useState<OptimizationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<Date | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const result = await runOptimizationAnalysis();
      setOptimizations(result);
      setLastAnalyzed(new Date());
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  // Auto-run on mount: first load pending, then run a fresh analysis
  useEffect(() => {
    getPendingOptimizations()
      .then((pending) => {
        setOptimizations(pending);
        // Only auto-analyze if no pending items (avoid redundant analysis)
        if (pending.length === 0) runAnalysis();
        else setLastAnalyzed(new Date());
      })
      .catch(() => runAnalysis());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApply = async (id: number) => {
    await applyOptimization(id);
    setOptimizations((prev) => prev.filter((o) => o.id !== id));
  };

  const handleDismiss = async (id: number) => {
    await dismissOptimization(id);
    setOptimizations((prev) => prev.filter((o) => o.id !== id));
  };

  const grouped = {
    high: optimizations.filter((o) => o.impact === "high"),
    medium: optimizations.filter((o) => o.impact === "medium"),
    low: optimizations.filter((o) => o.impact === "low"),
  };

  const lastAnalyzedLabel = lastAnalyzed
    ? `Last analyzed ${Math.floor((Date.now() - lastAnalyzed.getTime()) / 60000)}m ago`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 13, color: "var(--text-1)" }}>
            {loading ? "Analyzing…" : `${optimizations.length} pending optimizations`}
          </span>
          {lastAnalyzedLabel && !loading && (
            <span style={{ fontSize: 11, color: "var(--text-2)" }}>{lastAnalyzedLabel}</span>
          )}
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "var(--bg-2)",
            color: "var(--text-1)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
          {loading ? "Analyzing…" : "Re-analyze"}
        </button>
      </div>

      {(["high", "medium", "low"] as const).map((impact) => {
        const items = grouped[impact];
        if (items.length === 0) return null;
        const impactColors = { high: "#ef4444", medium: "#f59e0b", low: "#71717a" };
        const impactLabels = { high: "High", medium: "Medium", low: "Low" };
        return (
          <div key={impact}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: impactColors[impact], marginBottom: 6, textTransform: "uppercase" }}>
              {impactLabels[impact]} impact ({items.length})
            </h3>
            {items.map((opt) => (
              <div key={opt.id} className="card" style={{ padding: 12, marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-0)", marginBottom: 2 }}>
                      {opt.optimization_type.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-1)" }}>{opt.description}</div>
                    <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
                      {opt.evidence}
                      {opt.estimated_token_saving && ` · ~${opt.estimated_token_saving} tokens saved`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                    <button
                      onClick={() => handleApply(opt.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        background: "var(--accent)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Check size={12} /> Apply
                    </button>
                    <button
                      onClick={() => handleDismiss(opt.id)}
                      style={{
                        padding: "4px 8px",
                        fontSize: 11,
                        background: "var(--bg-2)",
                        color: "var(--text-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <X size={12} /> Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {!loading && optimizations.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>
          No pending optimizations — your context OS looks well-tuned.
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>
          Running analysis…
        </div>
      )}
    </div>
  );
}
