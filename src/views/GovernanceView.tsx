import { useEffect, useState } from "react";
import {
  Shield,
  AlertTriangle,
  Clock,
  ArrowUpFromLine,
  BarChart3,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getConflicts,
  getDecayCandidates,
  getConsolidationSuggestions,
} from "../lib/tauri";
import { useAppStore } from "../lib/store";
import type { Conflict, ConsolidationSuggestion, MemoryMeta } from "../lib/types";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "../lib/types";

type Tab = "conflicts" | "decay" | "consolidation" | "stats";

export function GovernanceView() {
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [decayCandidates, setDecayCandidates] = useState<MemoryMeta[]>([]);
  const [consolidation, setConsolidation] = useState<ConsolidationSuggestion[]>([]);
  const { memories } = useAppStore();

  useEffect(() => {
    getConflicts().then(setConflicts).catch(console.error);
    getDecayCandidates().then(setDecayCandidates).catch(console.error);
    getConsolidationSuggestions().then(setConsolidation).catch(console.error);
  }, []);

  const tabs = [
    { id: "stats" as Tab, icon: BarChart3, label: "Stats" },
    { id: "conflicts" as Tab, icon: AlertTriangle, label: `Conflicts (${conflicts.length})` },
    { id: "decay" as Tab, icon: Clock, label: `Decay (${decayCandidates.length})` },
    { id: "consolidation" as Tab, icon: ArrowUpFromLine, label: `Consolidation (${consolidation.length})` },
  ];

  // Stats
  const typeGroups = memories.reduce(
    (acc, m) => {
      acc[m.memory_type] = (acc[m.memory_type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const avgImportance =
    memories.length > 0
      ? memories.reduce((sum, m) => sum + m.importance, 0) / memories.length
      : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-[color:var(--text-0)]">
          <Shield className="h-5 w-5 text-sky-300" />
          Governance Panel
        </h1>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] bg-[color:var(--bg-1)]/55">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-sky-500 text-sky-200"
                : "border-transparent text-[color:var(--text-2)] hover:text-[color:var(--text-0)]",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "stats" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total Memories" value={memories.length.toString()} />
              <StatCard label="Avg Importance" value={avgImportance.toFixed(2)} />
              <StatCard label="Conflicts" value={conflicts.length.toString()} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-medium text-[color:var(--text-1)]">
                Memories by Type
              </h3>
              <div className="space-y-2">
                {Object.entries(typeGroups).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: MEMORY_TYPE_COLORS[type as keyof typeof MEMORY_TYPE_COLORS] }}
                    />
                    <span className="w-24 text-sm text-[color:var(--text-1)]">
                      {MEMORY_TYPE_LABELS[type as keyof typeof MEMORY_TYPE_LABELS]}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-3)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(count / Math.max(1, memories.length)) * 100}%`,
                          backgroundColor: MEMORY_TYPE_COLORS[type as keyof typeof MEMORY_TYPE_COLORS],
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-mono text-[color:var(--text-2)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "conflicts" && (
          <div className="space-y-3">
            {conflicts.map((c, i) => (
              <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/8 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-300">
                    {c.memory_a} ↔ {c.memory_b}
                  </span>
                </div>
                <p className="text-sm text-[color:var(--text-1)]">{c.description}</p>
              </div>
            ))}
            {conflicts.length === 0 && (
              <p className="py-8 text-center text-sm text-[color:var(--text-2)]">
                No conflicts detected
              </p>
            )}
          </div>
        )}

        {activeTab === "decay" && (
          <div className="space-y-2">
            {decayCandidates.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/65 p-3">
                <Clock className="h-4 w-4 text-[color:var(--text-2)]" />
                <span className="text-sm text-[color:var(--text-1)]">{m.id}</span>
                <span className="text-xs text-[color:var(--text-2)]">{m.l0}</span>
                <span className="ml-auto text-xs text-[color:var(--text-2)]">
                  Last: {new Date(m.last_access).toLocaleDateString()}
                </span>
              </div>
            ))}
            {decayCandidates.length === 0 && (
              <p className="py-8 text-center text-sm text-[color:var(--text-2)]">
                No decay candidates
              </p>
            )}
          </div>
        )}

        {activeTab === "consolidation" && (
          <div className="space-y-3">
            {consolidation.map((s, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/65 p-3">
                <p className="mb-2 text-sm text-[color:var(--text-1)]">{s.summary}</p>
                <span className="text-xs text-[color:var(--text-2)]">
                  Suggested: {s.suggested_folder}
                </span>
              </div>
            ))}
            {consolidation.length === 0 && (
              <p className="py-8 text-center text-sm text-[color:var(--text-2)]">
                No consolidation suggestions
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)]/70 p-4">
      <p className="text-2xl font-semibold text-[color:var(--text-0)]">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--text-2)]">{label}</p>
    </div>
  );
}
