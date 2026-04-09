import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  Clock,
  ArrowUpFromLine,
  BarChart3,
  Trash2,
  Star,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";
import {
  getConflicts,
  getDecayCandidates,
  getConsolidationSuggestions,
  getScratchCandidates,
  getGodNodes,
  deleteMemory,
  getMemory,
  saveMemory,
} from "../lib/tauri";
import { useAppStore } from "../lib/store";
import type { Conflict, ConsolidationSuggestion, GodNode, MemoryMeta } from "../lib/types";
import { MEMORY_ONTOLOGY_COLORS, MEMORY_ONTOLOGY_LABELS } from "../lib/types";

type Tab = "stats" | "conflicts" | "decay" | "consolidation" | "scratch" | "god_nodes";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-80 rounded-lg border border-[var(--border)] bg-[color:var(--bg-1)] p-5 shadow-xl">
        <h3 className="mb-1 text-sm font-semibold text-[color:var(--text-0)]">{title}</h3>
        <p className="mb-4 text-xs text-[color:var(--text-2)]">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-[color:var(--danger)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function GovernanceView() {
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [decayCandidates, setDecayCandidates] = useState<MemoryMeta[]>([]);
  const [consolidation, setConsolidation] = useState<ConsolidationSuggestion[]>([]);
  const [scratchFiles, setScratchFiles] = useState<string[]>([]);
  const [godNodes, setGodNodes] = useState<GodNode[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogProps | null>(null);
  const [boostingId, setBoostingId] = useState<string | null>(null);
  const { memories } = useAppStore();

  const loadAll = useCallback(() => {
    getConflicts().then(setConflicts).catch(console.error);
    getDecayCandidates().then(setDecayCandidates).catch(console.error);
    getConsolidationSuggestions().then(setConsolidation).catch(console.error);
    getScratchCandidates().then(setScratchFiles).catch(console.error);
    getGodNodes().then(setGodNodes).catch(console.error);
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAll]);

  const confirmArchiveAll = () => {
    setConfirmDialog({
      title: `Archive ${decayCandidates.length} memories?`,
      description: "These memories haven't been accessed in a long time and will be permanently deleted.",
      confirmLabel: `Archive ${decayCandidates.length}`,
      onConfirm: async () => {
        setConfirmDialog(null);
        for (const m of decayCandidates) {
          try { await deleteMemory(m.id); } catch { /* skip */ }
        }
        setDecayCandidates([]);
      },
      onCancel: () => setConfirmDialog(null),
    });
  };

  const confirmClearAll = () => {
    setConfirmDialog({
      title: `Delete ${scratchFiles.length} scratch files?`,
      description: "These temporary files have exceeded their TTL and will be permanently deleted.",
      confirmLabel: `Delete ${scratchFiles.length}`,
      onConfirm: async () => {
        setConfirmDialog(null);
        for (const file of scratchFiles) {
          const id = file.split("/").pop()?.replace(".md", "");
          if (id) {
            try { await deleteMemory(id); } catch { /* skip */ }
          }
        }
        setScratchFiles([]);
      },
      onCancel: () => setConfirmDialog(null),
    });
  };

  const handleBoostImportance = async (godNode: GodNode) => {
    setBoostingId(godNode.memory_id);
    try {
      const memory = await getMemory(godNode.memory_id);
      const newImportance = Math.min(1.0, memory.meta.importance + 0.2);
      await saveMemory({
        id: memory.meta.id,
        meta: { ...memory.meta, importance: newImportance },
        l1_content: memory.l1_content,
        l2_content: memory.l2_content,
      });
      setGodNodes((prev) =>
        prev.map((gn) =>
          gn.memory_id === godNode.memory_id
            ? { ...gn, importance: newImportance, mismatch_score: gn.mismatch_score - 0.2 }
            : gn,
        ),
      );
    } catch (e) {
      console.error(e);
    } finally {
      setBoostingId(null);
    }
  };

  const tabs: { id: Tab; icon: typeof BarChart3; label: string }[] = [
    { id: "stats", icon: BarChart3, label: "Stats" },
    { id: "conflicts", icon: AlertTriangle, label: `Conflicts ${conflicts.length}` },
    { id: "decay", icon: Clock, label: `Decay ${decayCandidates.length}` },
    { id: "consolidation", icon: ArrowUpFromLine, label: `Consolidation ${consolidation.length}` },
    { id: "scratch", icon: Trash2, label: `Scratch TTL ${scratchFiles.length}` },
    { id: "god_nodes", icon: Star, label: `God Nodes ${godNodes.length}` },
  ];

  const typeGroups = memories.reduce(
    (acc, m) => {
      acc[m.ontology] = (acc[m.ontology] || 0) + 1;
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
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex items-center gap-1.5 border-b-2 px-4 py-2 text-[11px] font-medium transition-colors",
              activeTab === tab.id
                ? "border-[color:var(--accent)] text-[color:var(--text-0)]"
                : "border-transparent text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "stats" && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Total" value={memories.length.toString()} />
              <StatCard label="Avg Importance" value={avgImportance.toFixed(2)} />
              <StatCard label="Conflicts" value={conflicts.length.toString()} />
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
                By ontology
              </h3>
              <div className="space-y-1.5">
                {Object.entries(typeGroups).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: MEMORY_ONTOLOGY_COLORS[type as keyof typeof MEMORY_ONTOLOGY_COLORS] }}
                    />
                    <span className="w-20 text-xs text-[color:var(--text-1)]">
                      {MEMORY_ONTOLOGY_LABELS[type as keyof typeof MEMORY_ONTOLOGY_LABELS]}
                    </span>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[color:var(--bg-3)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(count / Math.max(1, memories.length)) * 100}%`,
                          backgroundColor: MEMORY_ONTOLOGY_COLORS[type as keyof typeof MEMORY_ONTOLOGY_COLORS],
                          opacity: 0.6,
                        }}
                      />
                    </div>
                    <span className="w-6 text-right font-mono text-[11px] text-[color:var(--text-2)]">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "conflicts" && (
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <div key={i} className="rounded-md border border-[color:var(--warning)]/20 bg-[color:var(--warning)]/5 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-[color:var(--warning)]" />
                  <span className="font-mono text-xs text-[color:var(--warning)]">
                    {c.memory_a} ↔ {c.memory_b}
                  </span>
                </div>
                <p className="text-xs text-[color:var(--text-1)]">{c.description}</p>
              </div>
            ))}
            {conflicts.length === 0 && (
              <Empty text="No conflicts detected" />
            )}
          </div>
        )}

        {activeTab === "decay" && (
          <div className="space-y-1.5">
            {decayCandidates.length > 1 && (
              <button
                onClick={confirmArchiveAll}
                className="mb-2 rounded-md bg-[color:var(--danger)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20"
              >
                Archive all ({decayCandidates.length})
              </button>
            )}
            {decayCandidates.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] px-3 py-2">
                <Clock className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-2)]" />
                <span className="text-xs font-medium text-[color:var(--text-1)]">{m.id}</span>
                <span className="flex-1 truncate text-[11px] text-[color:var(--text-2)]">{m.l0}</span>
                <span className="shrink-0 font-mono text-[10px] text-[color:var(--text-2)]">
                  {new Date(m.last_access).toLocaleDateString()}
                </span>
                <button
                  onClick={() =>
                    setConfirmDialog({
                      title: `Archive "${m.id}"?`,
                      description: "This memory will be permanently deleted.",
                      confirmLabel: "Archive",
                      onConfirm: async () => {
                        setConfirmDialog(null);
                        try {
                          await deleteMemory(m.id);
                          setDecayCandidates((prev) => prev.filter((c) => c.id !== m.id));
                        } catch (e) { console.error(e); }
                      },
                      onCancel: () => setConfirmDialog(null),
                    })
                  }
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20"
                >
                  Archive
                </button>
              </div>
            ))}
            {decayCandidates.length === 0 && (
              <Empty text="No decay candidates" />
            )}
          </div>
        )}

        {activeTab === "consolidation" && (
          <div className="space-y-2">
            {consolidation.map((s, i) => (
              <div key={i} className="rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
                <p className="mb-1 text-xs text-[color:var(--text-1)]">{s.summary}</p>
              </div>
            ))}
            {consolidation.length === 0 && (
              <Empty text="No consolidation suggestions" />
            )}
          </div>
        )}

        {activeTab === "god_nodes" && (
          <div className="space-y-2">
            <p className="mb-3 text-[11px] text-[color:var(--text-2)]">
              These memories are highly connected in your knowledge graph but have a low importance score.
              Boosting them helps the context router surface them more often.
            </p>
            {godNodes.map((gn) => {
              const mismatch = gn.mismatch_score;
              const color = MEMORY_ONTOLOGY_COLORS[gn.ontology];
              const isCritical = mismatch > 0.4;
              const label = isCritical ? "Undervalued — boost it" : "Slightly undervalued";
              return (
                <div
                  key={gn.memory_id}
                  className={clsx(
                    "rounded-md border px-3 py-2.5",
                    isCritical
                      ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5"
                      : "border-[var(--border)] bg-[color:var(--bg-0)]",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-medium text-[color:var(--text-0)]">
                      {gn.memory_id}
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-[10px] font-mono text-[color:var(--text-2)]">
                      <span>{gn.degree} connections</span>
                      <span>imp {gn.importance.toFixed(2)}</span>
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-[color:var(--text-2)] mb-2">{gn.l0}</p>
                  <div className="flex items-center justify-between">
                    <span
                      className={clsx(
                        "text-[10px] font-medium",
                        isCritical ? "text-[color:var(--accent)]" : "text-[color:var(--text-2)]",
                      )}
                    >
                      {label}
                    </span>
                    <button
                      onClick={() => handleBoostImportance(gn)}
                      disabled={boostingId === gn.memory_id}
                      className={clsx(
                        "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                        isCritical
                          ? "bg-[color:var(--accent)]/15 text-[color:var(--accent)] hover:bg-[color:var(--accent)]/25"
                          : "bg-[color:var(--bg-3)] text-[color:var(--text-1)] hover:bg-[color:var(--bg-2)]",
                        boostingId === gn.memory_id && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Zap className="h-2.5 w-2.5" />
                      {boostingId === gn.memory_id ? "Boosting…" : "Boost importance"}
                    </button>
                  </div>
                </div>
              );
            })}
            {godNodes.length === 0 && (
              <Empty text="No god nodes detected — importance scores are well-calibrated" />
            )}
          </div>
        )}

        {activeTab === "scratch" && (
          <div className="space-y-1.5">
            {scratchFiles.length > 1 && (
              <button
                onClick={confirmClearAll}
                className="mb-2 rounded-md bg-[color:var(--warning)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--warning)] hover:bg-[color:var(--warning)]/20"
              >
                Clear all ({scratchFiles.length})
              </button>
            )}
            {scratchFiles.map((file) => {
              const name = file.split("/").pop() || file;
              const id = name.replace(".md", "");
              return (
                <div key={file} className="flex items-center gap-2 rounded-md border border-[color:var(--warning)]/20 bg-[color:var(--warning)]/5 px-3 py-2">
                  <Trash2 className="h-3.5 w-3.5 shrink-0 text-[color:var(--warning)]" />
                  <span className="text-xs font-medium text-[color:var(--text-1)]">{name}</span>
                  <span className="flex-1 truncate font-mono text-[10px] text-[color:var(--text-2)]">{file}</span>
                  <button
                    onClick={() =>
                      setConfirmDialog({
                        title: `Delete "${name}"?`,
                        description: "This scratch file will be permanently deleted.",
                        confirmLabel: "Delete",
                        onConfirm: async () => {
                          setConfirmDialog(null);
                          try {
                            await deleteMemory(id);
                            setScratchFiles((prev) => prev.filter((f) => f !== file));
                          } catch (e) { console.error(e); }
                        },
                        onCancel: () => setConfirmDialog(null),
                      })
                    }
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--warning)] hover:bg-[color:var(--warning)]/20"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
            {scratchFiles.length === 0 && (
              <Empty text="No expired scratch files" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] p-3">
      <p className="text-xl font-semibold tabular-nums text-[color:var(--text-0)]">{value}</p>
      <p className="mt-0.5 text-[10px] text-[color:var(--text-2)]">{label}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-12 text-center text-xs text-[color:var(--text-2)]">{text}</p>
  );
}
