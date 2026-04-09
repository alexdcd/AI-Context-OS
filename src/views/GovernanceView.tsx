import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  ArrowUpFromLine,
  BarChart3,
  Trash2,
  Star,
} from "lucide-react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";
import {
  getConflicts,
  getDecayCandidates,
  getConsolidationSuggestions,
  getScratchCandidates,
  getGodNodes,
  deleteMemory,
} from "../lib/tauri";
import { useAppStore } from "../lib/store";
import type { Conflict, ConsolidationSuggestion, GodNode, MemoryMeta } from "../lib/types";
import { MEMORY_ONTOLOGY_COLORS, type MemoryOntology } from "../lib/types";

type Tab = "stats" | "conflicts" | "decay" | "consolidation" | "scratch" | "god_nodes";

export function GovernanceView() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [decayCandidates, setDecayCandidates] = useState<MemoryMeta[]>([]);
  const [consolidation, setConsolidation] = useState<ConsolidationSuggestion[]>([]);
  const [scratchFiles, setScratchFiles] = useState<string[]>([]);
  const [godNodes, setGodNodes] = useState<GodNode[]>([]);
  const { memories } = useAppStore();

  useEffect(() => {
    getConflicts().then(setConflicts).catch(console.error);
    getDecayCandidates().then(setDecayCandidates).catch(console.error);
    getConsolidationSuggestions().then(setConsolidation).catch(console.error);
    getScratchCandidates().then(setScratchFiles).catch(console.error);
    getGodNodes().then(setGodNodes).catch(console.error);
  }, []);

  const tabs: { id: Tab; icon: typeof BarChart3; label: string }[] = [
    { id: "stats", icon: BarChart3, label: t("governance.tabs.stats") },
    { id: "conflicts", icon: AlertTriangle, label: t("governance.tabs.conflicts", { count: conflicts.length }) },
    { id: "decay", icon: Clock, label: t("governance.tabs.decay", { count: decayCandidates.length }) },
    { id: "consolidation", icon: ArrowUpFromLine, label: t("governance.tabs.consolidation", { count: consolidation.length }) },
    { id: "scratch", icon: Trash2, label: t("governance.tabs.scratch", { count: scratchFiles.length }) },
    { id: "god_nodes", icon: Star, label: t("governance.tabs.godNodes", { count: godNodes.length }) },
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
              <StatCard label={t("governance.total")} value={memories.length.toString()} />
              <StatCard label={t("governance.avgImportance")} value={avgImportance.toFixed(2)} />
              <StatCard label={t("governance.conflicts")} value={conflicts.length.toString()} />
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-2)]">
                {t("governance.byOntology")}
              </h3>
              <div className="space-y-1.5">
                {Object.entries(typeGroups).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: MEMORY_ONTOLOGY_COLORS[type as keyof typeof MEMORY_ONTOLOGY_COLORS] }}
                    />
                    <span className="w-20 text-xs text-[color:var(--text-1)]">
                      {t(`ontologies.${type as MemoryOntology}` as const)}
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
              <Empty text={t("governance.noConflicts")} />
            )}
          </div>
        )}

        {activeTab === "decay" && (
          <div className="space-y-1.5">
            {decayCandidates.length > 1 && (
              <button
                onClick={async () => {
                  for (const m of decayCandidates) {
                    try { await deleteMemory(m.id); } catch { /* skip */ }
                  }
                  setDecayCandidates([]);
                }}
                className="mb-2 rounded-md bg-[color:var(--danger)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20"
              >
                {t("governance.archiveAll", { count: decayCandidates.length })}
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
                  onClick={async () => {
                    try {
                      await deleteMemory(m.id);
                      setDecayCandidates((prev) => prev.filter((c) => c.id !== m.id));
                    } catch (e) { console.error(e); }
                  }}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--danger)] hover:bg-[color:var(--danger)]/20"
                >
                  {t("governance.archive")}
                </button>
              </div>
            ))}
            {decayCandidates.length === 0 && (
              <Empty text={t("governance.noDecay")} />
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
              <Empty text={t("governance.noConsolidation")} />
            )}
          </div>
        )}

        {activeTab === "god_nodes" && (
          <div className="space-y-2">
            <p className="mb-3 text-[11px] text-[color:var(--text-2)]">
              {t("governance.godNodesDesc")}
            </p>
            {godNodes.map((gn) => {
              const mismatch = gn.mismatch_score;
              const color = MEMORY_ONTOLOGY_COLORS[gn.ontology];
              return (
                <div
                  key={gn.memory_id}
                  className="rounded-md border border-[var(--border)] bg-[color:var(--bg-0)] px-3 py-2.5"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-medium text-[color:var(--text-0)]">
                      {gn.memory_id}
                    </span>
                    <span className="ml-auto flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-[color:var(--text-2)]">
                        degree {gn.degree}
                      </span>
                      <span className="text-[color:var(--text-2)]">
                        imp {gn.importance.toFixed(2)}
                      </span>
                      <span
                        className={clsx(
                          "rounded px-1.5 py-0.5 font-medium",
                          mismatch > 0.4
                            ? "bg-[color:var(--accent)]/15 text-[color:var(--accent)]"
                            : "bg-[color:var(--bg-3)] text-[color:var(--text-2)]",
                        )}
                      >
                        {mismatch > 0 ? "+" : ""}{mismatch.toFixed(2)}
                      </span>
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-[color:var(--text-2)]">{gn.l0}</p>
                </div>
              );
            })}
            {godNodes.length === 0 && (
              <Empty text={t("governance.noGodNodes")} />
            )}
          </div>
        )}

        {activeTab === "scratch" && (
          <div className="space-y-1.5">
            {scratchFiles.length > 1 && (
              <button
                onClick={async () => {
                  for (const file of scratchFiles) {
                    const id = file.split("/").pop()?.replace(".md", "");
                    if (id) {
                      try { await deleteMemory(id); } catch { /* skip */ }
                    }
                  }
                  setScratchFiles([]);
                }}
                className="mb-2 rounded-md bg-[color:var(--warning)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--warning)] hover:bg-[color:var(--warning)]/20"
              >
                {t("governance.clearAll", { count: scratchFiles.length })}
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
                    onClick={async () => {
                      try {
                        await deleteMemory(id);
                        setScratchFiles((prev) => prev.filter((f) => f !== file));
                      } catch (e) { console.error(e); }
                    }}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--warning)] hover:bg-[color:var(--warning)]/20"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              );
            })}
            {scratchFiles.length === 0 && (
              <Empty text={t("governance.noScratch")} />
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
