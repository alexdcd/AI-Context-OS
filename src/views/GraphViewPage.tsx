import { useEffect, useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk-api.js";
import {
  ExternalLink,
  Network,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Layers,
} from "lucide-react";
import { clsx } from "clsx";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../lib/store";
import { saveMemory, getMemory } from "../lib/tauri";
import {
  MEMORY_ONTOLOGY_COLORS,
  MEMORY_ONTOLOGY_LABELS,
  type GraphNode as GNode,
  type GraphEdge,
  type MemoryOntology,
} from "../lib/types";

const elkWorkerUrl = new URL("elkjs/lib/elk-worker.min.js", import.meta.url).toString();
const elk = new ELK({ workerUrl: elkWorkerUrl });

interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { node: GNode; colorByCommunity: boolean };
  type?: string;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style?: { stroke?: string; strokeWidth?: number };
  labelStyle?: { fill?: string; fontSize?: number };
  animated?: boolean;
}

// Stable palette for up to 12 communities; cycles for larger counts
const COMMUNITY_PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#0ea5e9", "#22c55e", "#f43f5e", "#a16207", "#0891b2",
  "#7c3aed", "#059669",
];

function communityColor(community: number | null): string {
  if (community === null) return "#64748b";
  return COMMUNITY_PALETTE[community % COMMUNITY_PALETTE.length];
}

function MemoryNodeComponent({
  data,
}: {
  data: { node: GNode; colorByCommunity: boolean };
}) {
  const { t } = useTranslation();
  const gn = data.node;
  const color = data.colorByCommunity
    ? communityColor(gn.community)
    : (MEMORY_ONTOLOGY_COLORS[gn.ontology] ?? "#64748b");
  return (
    <div
      className="min-w-[180px] rounded border border-[var(--border)] bg-[color:var(--bg-1)] px-2.5 py-2"
      style={{ opacity: Math.max(0.4, gn.decay_score) }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-xs font-medium text-[color:var(--text-0)]">{gn.id}</span>
      </div>
      <div className="mt-1 max-h-[2.2em] overflow-hidden text-[10px] leading-relaxed text-[color:var(--text-2)]">
        {gn.label}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[10px] text-[color:var(--text-2)]">
          {t(`ontologies.${gn.ontology}` as const)}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[color:var(--text-2)]">
          {gn.importance.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = { memory: MemoryNodeComponent };

async function layoutWithElk(
  graphNodes: GNode[],
  graphEdges: { source: string; target: string; edge_type: string }[],
) {
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "55",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: graphNodes.map((n) => ({
      id: n.id,
      width: 210,
      height: 94,
    })),
    edges: graphEdges.map((e, i) => ({
      id: `elk-e-${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const layout = await elk.layout(elkGraph);
  const positions: Record<string, { x: number; y: number }> = {};
  for (const child of layout.children ?? []) {
    positions[child.id] = { x: child.x ?? 0, y: child.y ?? 0 };
  }
  return positions;
}

function edgeColor(type: string): string {
  const colors: Record<string, string> = {
    related: "#8a95a6",
    requires: "#9aa8c0",
    optional: "#9c9382",
  };
  return colors[type] ?? "#6b7280";
}

export function GraphViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { graphData, loadGraph, selectFile, setError } = useAppStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [layouting, setLayouting] = useState(false);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [edgeMode, setEdgeMode] = useState<"related" | "requires" | "optional">(
    "related",
  );
  const [ontologyFilter, setOntologyFilter] = useState<MemoryOntology | "all">("all");
  const [minImportance, setMinImportance] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [colorByCommunity, setColorByCommunity] = useState(false);
  const [flowInstance, setFlowInstance] = useState<
    ReactFlowInstance<FlowNode, FlowEdge> | null
  >(null);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const filteredData = useMemo(() => {
    if (!graphData) {
      return { nodes: [] as GNode[], edges: [] as GraphEdge[] };
    }
    let filtered = graphData.nodes;
    if (ontologyFilter !== "all") {
      filtered = filtered.filter((node) => node.ontology === ontologyFilter);
    }
    if (minImportance > 0) {
      filtered = filtered.filter((node) => node.importance >= minImportance);
    }
    const nodeIds = new Set(filtered.map((node) => node.id));
    const edgesFiltered = graphData.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    return { nodes: filtered, edges: edgesFiltered };
  }, [graphData, ontologyFilter, minImportance]);

  useEffect(() => {
    if (!graphData) return;

    if (!selectedNode) return;
    const nextSelected = graphData.nodes.find((node) => node.id === selectedNode.id) ?? null;
    setSelectedNode(nextSelected);
  }, [graphData, selectedNode]);

  useEffect(() => {
    if (filteredData.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      setLayouting(false);
      return;
    }

    const doLayout = async () => {
      setLayouting(true);

      let positions: Record<string, { x: number; y: number }>;
      try {
        positions = await layoutWithElk(filteredData.nodes, filteredData.edges);
      } catch {
        const cols = Math.max(1, Math.ceil(Math.sqrt(filteredData.nodes.length)));
        positions = {};
        filteredData.nodes.forEach((node, i) => {
          positions[node.id] = {
            x: (i % cols) * 280 + 50,
            y: Math.floor(i / cols) * 140 + 50,
          };
        });
      }

      const newNodes: FlowNode[] = filteredData.nodes.map((node) => ({
        id: node.id,
        type: "memory",
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { node, colorByCommunity },
      }));

      const newEdges: FlowEdge[] = filteredData.edges.map((edge, i) => ({
        id: `e-${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        label: edge.edge_type,
        animated: edge.edge_type === "requires",
        style: { stroke: edgeColor(edge.edge_type), strokeWidth: 1.5 },
        labelStyle: { fill: "#8b9cb4", fontSize: 10 },
      }));

      setNodes(newNodes);
      setEdges(newEdges);
      setLayouting(false);
      requestAnimationFrame(() => flowInstance?.fitView({ padding: 0.2, duration: 350 }));
    };

    void doLayout();
  }, [filteredData, layoutSeed, colorByCommunity, setNodes, setEdges, flowInstance]);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const newEdge: FlowEdge = {
        id: `e-new-${Date.now()}`,
        source: connection.source,
        target: connection.target,
        label: edgeMode,
        style: { stroke: edgeColor(edgeMode), strokeWidth: 1.5 },
        labelStyle: { fill: "#8b9cb4", fontSize: 10 },
      };
      setEdges((currentEdges) => addEdge(newEdge, currentEdges));

      try {
        const memory = await getMemory(connection.source);
        const ensureUniquePush = (arr: string[], value: string) => {
          if (!arr.includes(value)) arr.push(value);
        };

        if (edgeMode === "related") {
          ensureUniquePush(memory.meta.related, connection.target);
        } else if (memory.meta.system_role === "skill") {
          if (edgeMode === "requires") {
            ensureUniquePush(memory.meta.requires, connection.target);
          } else {
            ensureUniquePush(memory.meta.optional, connection.target);
          }
        } else {
          ensureUniquePush(memory.meta.related, connection.target);
        }

        await saveMemory({
          id: memory.meta.id,
          meta: memory.meta,
          l1_content: memory.l1_content,
          l2_content: memory.l2_content,
        });
      } catch (e) {
        setError(`Failed to update relationship: ${String(e)}`);
      }
    },
    [edgeMode, setEdges, setError],
  );

  const onNodeClick = useCallback(
    (_event: unknown, node: { data: { node: GNode } }) => {
      setSelectedNode(node.data.node);
    },
    [],
  );

  const onNodeDoubleClick = useCallback(
    async (_event: unknown, node: { id: string; data: { node: GNode } }) => {
      setSelectedNode(node.data.node);
      try {
        await selectFile(node.id);
        navigate("/");
      } catch (e) {
        setError(`Failed to open memory ${node.id}: ${String(e)}`);
      }
    },
    [navigate, selectFile, setError],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[11px] text-[color:var(--text-2)]">
          {t("graph.nodesEdges", { nodes: filteredData.nodes.length, edges: filteredData.edges.length })}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={ontologyFilter}
            onChange={(e) => setOntologyFilter(e.target.value as MemoryOntology | "all")}
            className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
          >
            <option value="all">{t("graph.filterAll")}</option>
            {(Object.keys(MEMORY_ONTOLOGY_LABELS) as MemoryOntology[]).map((ontology) => (
              <option key={ontology} value={ontology}>
                {MEMORY_ONTOLOGY_LABELS[ontology]}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <label className="text-[10px] text-[color:var(--text-2)]">Imp ≥</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={minImportance}
              onChange={(e) => setMinImportance(parseFloat(e.target.value))}
              className="h-1 w-16 accent-[color:var(--accent)]"
            />
            <span className="w-5 text-right font-mono text-[10px] text-[color:var(--text-2)]">
              {minImportance.toFixed(1)}
            </span>
          </div>

          <select
            value={edgeMode}
            onChange={(e) =>
              setEdgeMode(e.target.value as "related" | "requires" | "optional")
            }
            className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
          >
            <option value="related">related</option>
            <option value="requires">requires</option>
            <option value="optional">optional</option>
          </select>

          <button
            type="button"
            onClick={() => setColorByCommunity((prev) => !prev)}
            className={clsx(
              "rounded p-1 transition-colors",
              colorByCommunity
                ? "text-[color:var(--accent)] bg-[color:var(--accent)]/10"
                : "text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
            )}
            title={colorByCommunity ? t("graph.colorByOntology") : t("graph.colorByCommunity")}
          >
            <Layers className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLayoutSeed((prev) => prev + 1)}
            className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            title={t("graph.relayout")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowInspector((prev) => !prev)}
            className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            title={showInspector ? t("graph.hideInspector") : t("graph.showInspector")}
          >
            {showInspector ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--bg-0)]">
          {nodes.length > 0 ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onInit={setFlowInstance}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(255,255,255,0.03)" gap={24} />
              <Controls />
              <MiniMap
                nodeColor="rgba(255,255,255,0.15)"
                style={{
                  backgroundColor: "var(--bg-1)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                }}
              />
            </ReactFlow>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-[color:var(--text-2)]">
              <Network className="mb-3 h-8 w-8" />
              <p className="text-xs">{t("graph.noNodes")}</p>
            </div>
          )}
        </div>

        <aside
          className={clsx(
            "obs-inspector min-h-0",
            showInspector ? "w-[280px] opacity-100" : "pointer-events-none w-0 opacity-0",
          )}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[color:var(--bg-1)]">
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {selectedNode ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-[color:var(--text-0)]">{selectedNode.id}</p>
                    <p className="mt-0.5 text-[11px] text-[color:var(--text-2)]">{selectedNode.label}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <NodeMetric label={t("graph.ontology")} value={t(`ontologies.${selectedNode.ontology}` as const)} />
                    <NodeMetric label={t("graph.collection")} value={selectedNode.folder_category ?? "—"} />
                    <NodeMetric label={t("graph.importance")} value={selectedNode.importance.toFixed(2)} />
                    <NodeMetric label={t("graph.decay")} value={selectedNode.decay_score.toFixed(2)} />
                    <NodeMetric
                      label={t("graph.community")}
                      value={selectedNode.community !== null ? `#${selectedNode.community}` : "—"}
                      swatchColor={selectedNode.community !== null ? communityColor(selectedNode.community) : undefined}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void onNodeDoubleClick(null, { id: selectedNode.id, data: { node: selectedNode } })}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t("graph.openInExplorer")}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[color:var(--text-2)]">
                  {t("graph.clickToInspect")}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {layouting && (
        <div className="pointer-events-none absolute right-8 top-20 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)]">
          {t("graph.calculatingLayout")}
        </div>
      )}
    </div>
  );
}

function NodeMetric({
  label,
  value,
  swatchColor,
}: {
  label: string;
  value: string;
  swatchColor?: string;
}) {
  return (
    <div>
      <p className="text-[10px] text-[color:var(--text-2)]">{label}</p>
      <div className="flex items-center gap-1">
        {swatchColor && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: swatchColor }} />}
        <p className="truncate text-xs text-[color:var(--text-1)]">{value}</p>
      </div>
    </div>
  );
}
