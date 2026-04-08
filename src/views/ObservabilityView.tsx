import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Zap,
  Check,
  X,
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
} from "../lib/tauri";
import type {
  ContextRequestRecord,
  ObservabilityStats,
  TopMemoryRecord,
  UnusedMemoryRecord,
  OptimizationRecord,
} from "../lib/types";
// Store not used in this view currently (live events not yet wired)
// import { useObservabilityStore } from "../lib/observabilityStore";

type Tab = "live" | "intelligence" | "optimizations";

export function ObservabilityView() {
  const [activeTab, setActiveTab] = useState<Tab>("live");

  const tabs: { id: Tab; icon: typeof Activity; label: string }[] = [
    { id: "live", icon: Activity, label: "Live" },
    { id: "intelligence", icon: BarChart3, label: "Intelligence" },
    { id: "optimizations", icon: Zap, label: "Optimizations" },
  ];

  return (
    <div
      className="view-container h-full overflow-y-auto"
      style={{ padding: 24 }}
    >
        Observability

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

  const loadRequests = () => {
    getRecentContextRequests(20).then(setRequests).catch(console.error);
  };

  useEffect(() => {
    loadRequests();
    // Poll every 5 seconds for new requests
    const interval = setInterval(loadRequests, 5000);
    return () => clearInterval(interval);
  }, []);

  const last = requests[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            {last.tokens_used} / {last.token_budget} tokens ({last.memories_loaded} memories loaded)
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
                  {req.query.length > 60 ? req.query.slice(0, 60) + "..." : req.query}
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stat cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <StatCard label="Requests/week" value={stats.requests_this_week} delta={stats.requests_this_week - stats.requests_prev_week} />
          <StatCard label="Tokens served" value={stats.tokens_served_total} />
          <StatCard label="Active memories" value={`${stats.active_memories}/${stats.total_memories}`} />
          <StatCard label="Efficiency" value={`${stats.efficiency_percent.toFixed(0)}%`} />
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
                    {mem.times_served}x — {mem.typical_level} — {mem.pct_of_requests.toFixed(0)}%
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

function StatCard({ label, value, delta }: { label: string; value: string | number; delta?: number }) {
  return (
    <div className="card" style={{ padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-0)" }}>{value}</div>
      {delta !== undefined && delta !== 0 && (
        <div style={{ fontSize: 11, color: delta > 0 ? "#10b981" : "#ef4444", marginTop: 2 }}>
          {delta > 0 ? "+" : ""}{delta} vs last week
        </div>
      )}
    </div>
  );
}

// ─── Optimizations Tab ───

function OptimizationsTab() {
  const [optimizations, setOptimizations] = useState<OptimizationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getPendingOptimizations().then(setOptimizations).catch(console.error);
  }, []);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const result = await runOptimizationAnalysis();
      setOptimizations(result);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text-1)" }}>
          {optimizations.length} pending optimizations
        </span>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {(["high", "medium", "low"] as const).map((impact) => {
        const items = grouped[impact];
        if (items.length === 0) return null;
        const impactLabels = { high: "High", medium: "Medium", low: "Low" };
        const impactColors = { high: "#ef4444", medium: "#f59e0b", low: "#71717a" };
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
                      {opt.estimated_token_saving && ` — ~${opt.estimated_token_saving} tokens saved`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                    <button
                      onClick={() => handleApply(opt.id)}
                      title="Apply"
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
                      title="Dismiss"
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

      {optimizations.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-2)", fontSize: 13 }}>
          No pending optimizations. Run an analysis to find opportunities.
        </div>
      )}
    </div>
  );
}

