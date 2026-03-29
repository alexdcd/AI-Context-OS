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
} from "lucide-react";
import { clsx } from "clsx";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../lib/store";
import { saveMemory, getMemory } from "../lib/tauri";
import {
  MEMORY_TYPE_COLORS,
  MEMORY_TYPE_LABELS,
  type GraphNode as GNode,
  type GraphEdge,
  type MemoryType,
} from "../lib/types";

const elkWorkerUrl = new URL("elkjs/lib/elk-worker.min.js", import.meta.url).toString();
const elk = new ELK({ workerUrl: elkWorkerUrl });

interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: { node: GNode };
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

function MemoryNodeComponent({ data }: { data: { node: GNode } }) {
  const gn = data.node;
  const color = MEMORY_TYPE_COLORS[gn.memory_type] ?? "#64748b";
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
          {MEMORY_TYPE_LABELS[gn.memory_type]}
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
  const navigate = useNavigate();
  const { graphData, loadGraph, selectFile, setError } = useAppStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [layouting, setLayouting] = useState(false);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [edgeMode, setEdgeMode] = useState<"related" | "requires" | "optional">(
    "related",
  );
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [minImportance, setMinImportance] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);
  const [showInspector, setShowInspector] = useState(true);
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
    if (typeFilter !== "all") {
      filtered = filtered.filter((node) => node.memory_type === typeFilter);
    }
    if (minImportance > 0) {
      filtered = filtered.filter((node) => node.importance >= minImportance);
    }
    const nodeIds = new Set(filtered.map((node) => node.id));
    const edgesFiltered = graphData.edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
    return { nodes: filtered, edges: edgesFiltered };
  }, [graphData, typeFilter, minImportance]);

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
        data: { node },
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
  }, [filteredData, layoutSeed, setNodes, setEdges, flowInstance]);

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
        } else if (memory.meta.memory_type === "skill") {
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
          {filteredData.nodes.length} nodes · {filteredData.edges.length} edges
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MemoryType | "all")}
            className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
          >
            <option value="all">All types</option>
            {(Object.keys(MEMORY_TYPE_LABELS) as MemoryType[]).map((type) => (
              <option key={type} value={type}>
                {MEMORY_TYPE_LABELS[type]}
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
            onClick={() => setLayoutSeed((prev) => prev + 1)}
            className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            title="Re-layout"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowInspector((prev) => !prev)}
            className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
            title={showInspector ? "Hide inspector" : "Show inspector"}
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
              <p className="text-xs">No nodes for current filter.</p>
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
                    <NodeMetric label="Type" value={MEMORY_TYPE_LABELS[selectedNode.memory_type]} />
                    <NodeMetric label="Importance" value={selectedNode.importance.toFixed(2)} />
                    <NodeMetric label="Decay" value={selectedNode.decay_score.toFixed(2)} />
                    <NodeMetric
                      label="Color"
                      value={selectedNode.memory_type}
                      swatchColor={MEMORY_TYPE_COLORS[selectedNode.memory_type]}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void onNodeDoubleClick(null, { id: selectedNode.id, data: { node: selectedNode } })}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Explorer
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[color:var(--text-2)]">
                  Click a node to inspect. Double-click to open.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {layouting && (
        <div className="pointer-events-none absolute right-8 top-20 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)]">
          Calculando layout...
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
