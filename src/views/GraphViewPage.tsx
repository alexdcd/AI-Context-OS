import { createContext, useContext, useEffect, useCallback, useMemo, useRef, useState, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type ReactFlowInstance,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as d3 from "d3-force";
import {
  AlertTriangle,
  ExternalLink,
  LayoutGrid,
  Network,
  Orbit,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Layers,
  Link2,
} from "lucide-react";
import { clsx } from "clsx";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../lib/store";
import { saveMemory, getMemory } from "../lib/tauri";
import {
  MEMORY_ONTOLOGY_COLORS,
  type GraphNode as GNode,
  type GraphEdge,
  type MemoryOntology,
} from "../lib/types";

// ---------------------------------------------------------------------------
// Hover context — avoids rebuilding all nodes on hover change
// ---------------------------------------------------------------------------

interface HoverCtx {
  hoveredId: string | null;
  firstDegree: Set<string>;
  secondDegree: Set<string>;
}

const HoverContext = createContext<HoverCtx>({
  hoveredId: null,
  firstDegree: new Set(),
  secondDegree: new Set(),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ViewMode = "cards" | "cosmos";

const COMMUNITY_PALETTE = [
  "#818cf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa",
  "#38bdf8", "#4ade80", "#fb7185", "#d97706", "#22d3ee",
  "#8b5cf6", "#10b981",
];

const EDGE_COLORS: Record<string, string> = {
  related: "#475569",
  requires: "#6366f1",
  optional: "#78716c",
  wikilink: "#059669",
  tag: "#7c3aed",
};

function communityColor(community: number | null): string {
  if (community === null) return "#64748b";
  return COMMUNITY_PALETTE[community % COMMUNITY_PALETTE.length];
}

function cardWidth(degree: number): number {
  return 160 + Math.min(degree * 10, 80);
}

function cosmosRadius(degree: number): number {
  return Math.max(12, Math.min(12 + Math.log(degree + 1) * 8, 34));
}

// ---------------------------------------------------------------------------
// Force simulation types
// ---------------------------------------------------------------------------

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number;
}

function createSimulation(
  gnodes: GNode[],
  gedges: GraphEdge[],
  mode: ViewMode,
): { simulation: d3.Simulation<SimNode, SimLink>; simNodes: SimNode[] } {
  const simNodes: SimNode[] = gnodes.map((n, i) => ({
    id: n.id,
    x: Math.cos(2 * Math.PI * i / gnodes.length) * 200 + (Math.random() - 0.5) * 40,
    y: Math.sin(2 * Math.PI * i / gnodes.length) * 200 + (Math.random() - 0.5) * 40,
  }));

  const nodeSet = new Set(gnodes.map((n) => n.id));
  const simLinks: SimLink[] = gedges
    .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, weight: e.weight ?? 0.5 }));

  const linkDist = mode === "cosmos" ? 110 : 160;
  const charge = mode === "cosmos" ? -280 : -400;
  const collide = mode === "cosmos" ? 40 : 90;

  const simulation = d3.forceSimulation<SimNode, SimLink>(simNodes)
    .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(linkDist).strength((l) => 0.2 + 0.3 * l.weight))
    .force("charge", d3.forceManyBody().strength(charge).distanceMax(500))
    .force("center", d3.forceCenter(0, 0).strength(0.05))
    .force("collide", d3.forceCollide(collide))
    .alphaDecay(0.018)
    .velocityDecay(0.35);

  simulation.stop().tick(350);
  return { simulation, simNodes };
}

// ---------------------------------------------------------------------------
// Node data (stable — does NOT contain hover state)
// ---------------------------------------------------------------------------

interface NodeData extends Record<string, unknown> {
  node: GNode;
  colorByCommunity: boolean;
  godMode: boolean;
  godIds: Set<string>;
}

interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: NodeData;
  type?: string;
  style?: Record<string, unknown>;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  style?: Record<string, unknown>;
  labelStyle?: Record<string, unknown>;
  animated?: boolean;
  markerEnd?: { type: MarkerType; color?: string; width?: number; height?: number };
}

// ---------------------------------------------------------------------------
// Cards node
// ---------------------------------------------------------------------------

const CardsNode = memo(function CardsNode({ data }: { data: NodeData }) {
  const { node: gn, colorByCommunity, godMode, godIds } = data;
  const { t } = useTranslation();
  const { hoveredId, firstDegree } = useContext(HoverContext);

  const isGod = godMode && godIds.has(gn.id);
  const color = isGod ? "#ef4444"
    : colorByCommunity ? communityColor(gn.community)
    : (MEMORY_ONTOLOGY_COLORS[gn.ontology] ?? "#64748b");

  const hasHover = !!hoveredId;
  const isFocus = hoveredId === gn.id;
  const isNeighbor = firstDegree.has(gn.id) && !isFocus;
  const isBg = hasHover && !isFocus && !isNeighbor;

  return (
    <div
      className="graph-node-card"
      style={{
        width: cardWidth(gn.degree),
        opacity: isBg ? 0.18 : hasHover && !isFocus ? 0.85 : Math.max(0.5, gn.decay_score),
        zIndex: isFocus ? 20 : isNeighbor ? 10 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className="rounded-lg border bg-[color:var(--bg-1)] px-2.5 py-2"
        style={{
          borderColor: isFocus ? color : isNeighbor ? `${color}60` : "var(--border)",
          boxShadow: isGod
            ? `0 0 0 2px #ef4444, 0 0 16px #ef444440`
            : isFocus
              ? `0 0 0 1.5px ${color}, 0 0 20px ${color}35`
              : "none",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="shrink-0 rounded-full"
            style={{
              backgroundColor: color,
              width: 6 + Math.min(gn.degree * 1.5, 8),
              height: 6 + Math.min(gn.degree * 1.5, 8),
            }}
          />
          <span className="truncate text-xs font-medium text-[color:var(--text-0)]">{gn.id}</span>
          {gn.degree > 0 && (
            <span className="ml-auto shrink-0 rounded bg-[color:var(--bg-2)] px-1 font-mono text-[9px] text-[color:var(--text-2)]">
              {gn.degree}
            </span>
          )}
        </div>
        <div className="mt-1 max-h-[2.2em] overflow-hidden text-[10px] leading-relaxed text-[color:var(--text-2)]">
          {gn.label}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-[color:var(--text-2)]">{t(`ontologies.${gn.ontology}`)}</span>
          <span className="ml-auto font-mono text-[10px] text-[color:var(--text-2)]">{gn.importance.toFixed(1)}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Star SVG for structural nodes (system_role = rule | skill)
// ---------------------------------------------------------------------------

function StarShape({ size, color, borderColor, borderWidth }: {
  size: number;
  color: string;
  borderColor: string;
  borderWidth: number;
}) {
  const spikes = 8;
  const outerR = size / 2;
  const innerR = outerR * 0.55;
  const cx = outerR;
  const cy = outerR;

  const points: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / spikes - Math.PI / 2;
    points.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="graph-cosmos-star">
      <polygon
        points={points.join(" ")}
        fill={color}
        stroke={borderColor}
        strokeWidth={borderWidth}
        strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r={innerR * 0.4} fill="rgba(0,0,0,0.3)" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Cosmos node — reads hover state from context (no re-render cascade)
// ---------------------------------------------------------------------------

const CosmosNode = memo(function CosmosNode({ data }: { data: NodeData }) {
  const { node: gn, colorByCommunity, godMode, godIds } = data;
  const { hoveredId, firstDegree } = useContext(HoverContext);

  const isGod = godMode && godIds.has(gn.id);
  const color = isGod ? "#ef4444"
    : colorByCommunity ? communityColor(gn.community)
    : (MEMORY_ONTOLOGY_COLORS[gn.ontology] ?? "#64748b");

  const hasHover = !!hoveredId;
  const isFocus = hoveredId === gn.id;
  const isNeighbor = firstDegree.has(gn.id) && !isFocus;
  const isBg = hasHover && !isFocus && !isNeighbor;

  const isStar = !!gn.system_role;
  const r = cosmosRadius(gn.degree);
  const starBonus = isStar ? 4 : 0;
  const diam = (r + starBonus) * 2;

  const borderColor = isFocus
    ? "rgba(255,255,255,0.85)"
    : isNeighbor
      ? "rgba(255,255,255,0.35)"
      : "rgba(255,255,255,0.06)";
  const borderWidth = isFocus ? 2 : isNeighbor ? 1.5 : 0.8;

  const shadow = isGod
    ? `0 0 0 2px #ef4444, 0 0 18px ${color}70`
    : isFocus
      ? `0 0 20px ${color}80, 0 0 6px ${color}`
      : isNeighbor
        ? `0 0 12px ${color}50`
        : `0 0 4px ${color}25`;

  return (
    <div
      className="graph-node-cosmos"
      style={{
        width: diam + 70,
        opacity: isBg ? 0.15 : hasHover && !isFocus && !isNeighbor ? 0.4 : Math.max(0.45, gn.decay_score),
        transform: isFocus ? "scale(1.2)" : isNeighbor ? "scale(1.06)" : "scale(1)",
        zIndex: isFocus ? 20 : isNeighbor ? 10 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div className="flex justify-center" style={{ filter: `drop-shadow(${shadow.split(",").pop()?.trim() ?? "none"})` }}>
        {isStar ? (
          <StarShape
            size={diam}
            color={color}
            borderColor={borderColor}
            borderWidth={borderWidth}
          />
        ) : (
          <div
            className="graph-cosmos-circle"
            style={{
              width: diam,
              height: diam,
              backgroundColor: color,
              border: `${borderWidth}px solid ${borderColor}`,
              boxShadow: shadow,
            }}
          />
        )}
      </div>
      {/* Label: hidden for background nodes */}
      {!isBg && (
        <div
          className="graph-cosmos-label"
          style={{
            fontSize: isFocus ? 12 : Math.max(9, Math.min(10 + gn.degree * 0.5, 11)),
            fontWeight: isFocus ? 600 : isNeighbor ? 500 : 400,
            maxWidth: diam + 70,
            color: isFocus ? "var(--text-0)" : isNeighbor ? "var(--text-1)" : "var(--text-2)",
          }}
        >
          {isFocus ? (
            <span className="graph-cosmos-label-pill">
              {gn.label || gn.id}
            </span>
          ) : (
            gn.label || gn.id
          )}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Floating hover preview panel
// ---------------------------------------------------------------------------

function HoverPreviewPanel({ node, visible }: { node: GNode | null; visible: boolean }) {
  const { t } = useTranslation();
  if (!node) return null;

  const color = MEMORY_ONTOLOGY_COLORS[node.ontology] ?? "#64748b";

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 z-50 w-64 rounded-xl border border-[var(--border)] shadow-2xl"
      style={{
        backgroundColor: "rgba(var(--bg-1-rgb, 15,15,20), 0.88)",
        backdropFilter: "blur(12px)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(6px) scale(0.97)",
        transition: "opacity 0.2s ease, transform 0.2s ease",
      }}
    >
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="truncate text-xs font-semibold text-[color:var(--text-0)]">{node.label || node.id}</span>
        </div>
        {node.preview && (
          <p className="mt-2 text-[10px] leading-relaxed text-[color:var(--text-2)]">
            {node.preview.slice(0, 200)}{node.preview.length > 200 ? "…" : ""}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ backgroundColor: `${color}20`, color }}>
            {t(`ontologies.${node.ontology}`)}
          </span>
          {node.degree > 0 && (
            <span className="rounded-full bg-[color:var(--bg-2)] px-1.5 py-0.5 text-[9px] text-[color:var(--text-2)]">
              {node.degree} links
            </span>
          )}
          <span className="ml-auto text-[9px] text-[color:var(--text-2)]">
            ⚡ {node.importance.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = {
  cards: CardsNode,
  cosmos: CosmosNode,
};

// ---------------------------------------------------------------------------
// View mode toggle
// ---------------------------------------------------------------------------

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange("cards")}
        className={clsx(
          "flex items-center gap-1 px-2.5 py-1 text-[10px] transition-all",
          mode === "cards"
            ? "bg-[color:var(--accent)] text-white"
            : "bg-[color:var(--bg-2)] text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
        )}
        title={t("graph.viewCardsTooltip")}
      >
        <LayoutGrid className="h-3 w-3" />
        <span>{t("graph.viewCards")}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("cosmos")}
        className={clsx(
          "flex items-center gap-1 px-2.5 py-1 text-[10px] transition-all border-l border-[var(--border)]",
          mode === "cosmos"
            ? "bg-[color:var(--accent)] text-white"
            : "bg-[color:var(--bg-2)] text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
        )}
        title={t("graph.viewCosmosTooltip")}
      >
        <Orbit className="h-3 w-3" />
        <span>{t("graph.viewCosmos")}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GraphViewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const graphData = useAppStore((state) => state.graphData);
  const loadGraph = useAppStore((state) => state.loadGraph);
  const selectFile = useAppStore((state) => state.selectFile);
  const setError = useAppStore((state) => state.setError);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [layouting, setLayouting] = useState(false);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("cosmos");
  const [edgeMode, setEdgeMode] = useState<"related" | "requires" | "optional">("related");
  const [ontologyFilter, setOntologyFilter] = useState<MemoryOntology | "all">("all");
  const [minImportance, setMinImportance] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GNode | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [colorByCommunity, setColorByCommunity] = useState(false);
  const [godMode, setGodMode] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  const draggedNodeIdRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverPreviewNode, setHoverPreviewNode] = useState<GNode | null>(null);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const godIds = useMemo<Set<string>>(() => {
    if (!graphData) return new Set();
    const maxDeg = Math.max(1, ...graphData.nodes.map((n) => n.degree));
    return new Set(
      graphData.nodes
        .filter((n) => (n.degree / maxDeg) - n.importance > 0.2 || n.degree >= 2)
        .map((n) => n.id),
    );
  }, [graphData]);

  const filteredData = useMemo(() => {
    if (!graphData) return { nodes: [] as GNode[], edges: [] as GraphEdge[] };
    let filtered = graphData.nodes;
    if (ontologyFilter !== "all") filtered = filtered.filter((n) => n.ontology === ontologyFilter);
    if (minImportance > 0) filtered = filtered.filter((n) => n.importance >= minImportance);
    const nodeIds = new Set(filtered.map((n) => n.id));
    return {
      nodes: filtered,
      edges: graphData.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)),
    };
  }, [graphData, ontologyFilter, minImportance]);

  useEffect(() => {
    if (!graphData || !selectedNode) return;
    const nextSelectedNode = graphData.nodes.find((n) => n.id === selectedNode.id) ?? null;
    if (nextSelectedNode !== selectedNode) setSelectedNode(nextSelectedNode);
  }, [graphData, selectedNode]);

  const backlinksMap = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!graphData) return map;
    for (const e of graphData.edges) {
      const addLink = (key: string, val: string) => {
        const arr = map.get(key) ?? [];
        if (!arr.includes(val)) arr.push(val);
        map.set(key, arr);
      };
      addLink(e.target, e.source);
      addLink(e.source, e.target);
    }
    return map;
  }, [graphData]);

  // ---------- Hover emphasis sets (for context + edge styling) ----------
  const hoverCtx = useMemo<HoverCtx>(() => {
    const first = new Set<string>();
    const second = new Set<string>();
    if (!hoveredNodeId) return { hoveredId: null, firstDegree: first, secondDegree: second };
    first.add(hoveredNodeId);
    for (const e of filteredData.edges) {
      if (e.source === hoveredNodeId) first.add(e.target);
      if (e.target === hoveredNodeId) first.add(e.source);
    }
    for (const neighborId of first) {
      if (neighborId === hoveredNodeId) continue;
      for (const e of filteredData.edges) {
        const otherId = e.source === neighborId ? e.target : e.target === neighborId ? e.source : null;
        if (otherId && !first.has(otherId)) second.add(otherId);
      }
    }
    return { hoveredId: hoveredNodeId, firstDegree: first, secondDegree: second };
  }, [hoveredNodeId, filteredData.edges]);

  // ---------- Build flow data (only on layout/filter/color changes, NOT hover) ----------
  const buildFlowData = useCallback((simNodes: SimNode[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of simNodes) positions[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };

    const newNodes: FlowNode[] = filteredData.nodes.map((node) => {
      const isCards = viewMode === "cards";
      const w = isCards ? cardWidth(node.degree) : (cosmosRadius(node.degree) * 2 + 70);
      return {
        id: node.id,
        type: viewMode,
        position: positions[node.id] ?? { x: 0, y: 0 },
        style: { width: w },
        data: { node, colorByCommunity, godMode, godIds },
      };
    });

    return newNodes;
  }, [filteredData, viewMode, colorByCommunity, godMode, godIds]);

  // ---------- Build edges (separate, rebuilt on hover for emphasis) ----------
  const buildEdges = useCallback((): FlowEdge[] => {
    const hasHover = !!hoveredNodeId;
    const { firstDegree } = hoverCtx;

    return filteredData.edges.map((edge, i) => {
      const srcConnected = firstDegree.has(edge.source);
      const tgtConnected = firstDegree.has(edge.target);
      const bothConnected = srcConnected && tgtConnected;
      const oneConnected = srcConnected || tgtConnected;

      let strokeColor: string;
      let strokeWidth: number;
      let opacity: number;

      if (hasHover) {
        if (bothConnected) {
          strokeColor = EDGE_COLORS[edge.edge_type] ?? "#94a3b8";
          strokeWidth = Math.max(1.5, (edge.weight ?? 0.5) * 2.5);
          opacity = 0.85;
        } else if (oneConnected) {
          strokeColor = EDGE_COLORS[edge.edge_type] ?? "#475569";
          strokeWidth = Math.max(0.8, (edge.weight ?? 0.5) * 1.5);
          opacity = 0.25;
        } else {
          strokeColor = "#334155";
          strokeWidth = 0.5;
          opacity = 0.06;
        }
      } else {
        strokeColor = EDGE_COLORS[edge.edge_type] ?? "#475569";
        strokeWidth = viewMode === "cosmos"
          ? Math.max(0.6, (edge.weight ?? 0.5) * 1.5)
          : Math.max(0.8, (edge.weight ?? 0.5) * 2);
        opacity = 0.4;
      }

      return {
        id: `e-${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        type: "straight",
        style: {
          stroke: strokeColor,
          strokeWidth,
          opacity,
          transition: "stroke 0.25s ease, stroke-width 0.25s ease, opacity 0.25s ease",
          strokeDasharray: edge.edge_type === "tag" && !bothConnected ? "3 4" : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: strokeColor,
          width: bothConnected && hasHover ? 14 : 10,
          height: bothConnected && hasHover ? 14 : 10,
        },
      };
    });
  }, [filteredData.edges, hoveredNodeId, hoverCtx, viewMode]);

  // Create simulation and run initial layout
  useEffect(() => {
    if (filteredData.nodes.length === 0) {
      setNodes([]);
      setEdges([]);
      simulationRef.current?.stop();
      simulationRef.current = null;
      simNodesRef.current = [];
      simNodeMapRef.current = new Map();
      draggedNodeIdRef.current = null;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      return;
    }

    setLayouting(true);
    const { simulation, simNodes } = createSimulation(filteredData.nodes, filteredData.edges, viewMode);
    simulationRef.current = simulation;
    simNodesRef.current = simNodes;
    simNodeMapRef.current = new Map(simNodes.map((node) => [node.id, node]));

    const newNodes = buildFlowData(simNodes);
    setNodes(newNodes);
    setEdges(buildEdges());

    simulation.on("tick", () => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const draggedNodeId = draggedNodeIdRef.current;
        const positions = new Map(
          simNodesRef.current.map((simNode) => [
            simNode.id,
            { x: simNode.x ?? 0, y: simNode.y ?? 0 },
          ]),
        );

        setNodes((prev) =>
          prev.map((flowNode) => {
            if (flowNode.id === draggedNodeId) return flowNode;
            const nextPosition = positions.get(flowNode.id);
            if (!nextPosition) return flowNode;
            if (flowNode.position.x === nextPosition.x && flowNode.position.y === nextPosition.y) return flowNode;
            return { ...flowNode, position: nextPosition };
          }),
        );
      });
    });

    setLayouting(false);

    return () => {
      simulation.on("tick", null);
      simulation.stop();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData, layoutSeed, viewMode]);

  // Update node data (colors only, NOT hover) without recomputing layout
  useEffect(() => {
    if (simNodesRef.current.length === 0) return;
    const newNodes = buildFlowData(simNodesRef.current);
    setNodes(newNodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorByCommunity, godMode, godIds]);

  // Update edges on hover change (lightweight — only edge objects, not nodes)
  useEffect(() => {
    if (filteredData.edges.length === 0) return;
    setEdges(buildEdges());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredNodeId]);

  // Fit view after layout
  useEffect(() => {
    if (flowInstance && nodes.length > 0 && !layouting) {
      requestAnimationFrame(() => flowInstance.fitView({ padding: 0.15, duration: 500 }));
    }
  }, [flowInstance, nodes.length, layouting]);

  // --- Drag ---
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const sim = simulationRef.current;
    if (!sim) return;
    draggedNodeIdRef.current = node.id;
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) { simNode.fx = node.position.x; simNode.fy = node.position.y; }
    sim.alphaTarget(0.3).restart();
  }, []);

  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) { simNode.fx = node.position.x; simNode.fy = node.position.y; }
  }, []);

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const sim = simulationRef.current;
    if (!sim) return;
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) { simNode.fx = null; simNode.fy = null; }
    draggedNodeIdRef.current = null;
    sim.alphaTarget(0);
  }, []);

  // --- Hover ---
  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: FlowNode) => {
    setHoveredNodeId(node.id);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverPreviewNode(node.data.node);
    }, 150);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoverPreviewNode(null);
    }, 250);
  }, []);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setEdges((cur) =>
        addEdge(
          {
            id: `e-new-${Date.now()}`,
            source: connection.source!,
            target: connection.target!,
            label: edgeMode,
            type: "straight",
            style: { stroke: EDGE_COLORS[edgeMode], strokeWidth: 1.5 },
            labelStyle: { fill: "#8b9cb4", fontSize: 9 },
          },
          cur,
        ),
      );
      try {
        const memory = await getMemory(connection.source);
        const push = (arr: string[], v: string) => { if (!arr.includes(v)) arr.push(v); };
        if (edgeMode === "related") push(memory.meta.related, connection.target);
        else if (memory.meta.system_role === "skill") {
          if (edgeMode === "requires") push(memory.meta.requires, connection.target);
          else push(memory.meta.optional, connection.target);
        } else {
          push(memory.meta.related, connection.target);
        }
        await saveMemory({ id: memory.meta.id, meta: memory.meta, l1_content: memory.l1_content, l2_content: memory.l2_content });
      } catch (e) {
        setError(`Failed to update relationship: ${String(e)}`);
      }
    },
    [edgeMode, setEdges, setError],
  );

  const onNodeClick = useCallback((_: unknown, node: { data: NodeData }) => {
    setSelectedNode(node.data.node);
  }, []);

  const onNodeDoubleClick = useCallback(
    async (_: unknown, node: { id: string }) => {
      try {
        await selectFile(node.id);
        navigate("/");
      } catch (e) {
        setError(`Failed to open memory ${node.id}: ${String(e)}`);
      }
    },
    [navigate, selectFile, setError],
  );

  const handleViewModeChange = useCallback((m: ViewMode) => {
    setViewMode(m);
    setLayoutSeed((p) => p + 1);
  }, []);

  return (
    <HoverContext.Provider value={hoverCtx}>
      <div className="relative flex h-full min-h-0 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <ViewModeToggle mode={viewMode} onChange={handleViewModeChange} />

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
              {(["source", "entity", "concept", "synthesis", "unknown"] as MemoryOntology[]).map((o) => (
                <option key={o} value={o}>{t(`ontologies.${o}`)}</option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <label className="text-[10px] text-[color:var(--text-2)]">{t("graph.importanceLabel")}</label>
              <input
                type="range" min="0" max="1" step="0.1"
                value={minImportance}
                onChange={(e) => setMinImportance(parseFloat(e.target.value))}
                className="h-1 w-16 accent-[color:var(--accent)]"
              />
            </div>

            <select
              value={edgeMode}
              onChange={(e) => setEdgeMode(e.target.value as "related" | "requires" | "optional")}
              className="rounded border border-[var(--border)] bg-[color:var(--bg-2)] px-2 py-1 text-[11px] text-[color:var(--text-1)]"
            >
              <option value="related">{t("graph.edgeRelated")}</option>
              <option value="requires">{t("graph.edgeRequires")}</option>
              <option value="optional">{t("graph.edgeOptional")}</option>
            </select>

            <button
              type="button"
              onClick={() => setGodMode((p) => !p)}
              className={clsx(
                "flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-colors",
                godMode ? "bg-red-500/15 text-red-400" : "text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
              )}
              title={t("graph.highlightGodNodes")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {godMode && godIds.size > 0 && <span>{godIds.size}</span>}
            </button>

            <button
              type="button"
              onClick={() => setColorByCommunity((p) => !p)}
              className={clsx(
                "rounded p-1 transition-colors",
                colorByCommunity
                  ? "bg-[color:var(--accent)]/10 text-[color:var(--accent)]"
                  : "text-[color:var(--text-2)] hover:text-[color:var(--text-1)]",
              )}
              title={colorByCommunity ? t("graph.colorByOntology") : t("graph.colorByCommunity")}
            >
              <Layers className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setLayoutSeed((p) => p + 1)}
              className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
              title={t("graph.relayout")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowInspector((p) => !p)}
              className="rounded p-1 text-[color:var(--text-2)] hover:text-[color:var(--text-1)]"
              title={showInspector ? t("graph.hideInspector") : t("graph.showInspector")}
            >
              {showInspector ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* Canvas */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[color:var(--bg-0)]">
            {nodes.length > 0 ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}
                onInit={setFlowInstance}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={{ type: "straight" }}
              >
                {viewMode === "cosmos" ? (
                  <Background color="rgba(255,255,255,0.02)" gap={40} size={0.8} />
                ) : (
                  <Background color="rgba(255,255,255,0.025)" gap={24} />
                )}
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap
                  nodeColor={(n) => {
                    const nd = (n.data as NodeData | undefined)?.node;
                    if (!nd) return "rgba(255,255,255,0.15)";
                    return colorByCommunity
                      ? communityColor(nd.community)
                      : (MEMORY_ONTOLOGY_COLORS[nd.ontology] ?? "#64748b");
                  }}
                  style={{
                    backgroundColor: "var(--bg-1)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                  }}
                  maskColor="rgba(0,0,0,0.6)"
                />
              </ReactFlow>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-[color:var(--text-2)]">
                <Network className="mb-3 h-8 w-8" />
                <p className="text-xs">{t("graph.noNodes")}</p>
              </div>
            )}

            <HoverPreviewPanel
              node={hoverPreviewNode}
              visible={!!hoverPreviewNode && !!hoveredNodeId}
            />
          </div>

          {/* Inspector */}
          <aside
            className={clsx(
              "obs-inspector min-h-0 transition-all",
              showInspector ? "w-[280px] opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[color:var(--bg-1)]">
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {selectedNode ? (
                  <InspectorPanel
                    node={selectedNode}
                    backlinks={backlinksMap.get(selectedNode.id) ?? []}
                    graphNodes={graphData?.nodes ?? []}
                    colorByCommunity={colorByCommunity}
                    onOpenNode={(id) => void onNodeDoubleClick(null, { id })}
                    onSelectNode={(id) => setSelectedNode(graphData?.nodes.find((n) => n.id === id) ?? null)}
                  />
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
          <div className="pointer-events-none absolute right-8 top-16 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-2.5 py-1 text-xs text-[color:var(--text-1)]">
            {t("graph.calculatingLayout")}
          </div>
        )}
      </div>
    </HoverContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

function InspectorPanel({
  node,
  backlinks,
  graphNodes,
  colorByCommunity,
  onOpenNode,
  onSelectNode,
}: {
  node: GNode;
  backlinks: string[];
  graphNodes: GNode[];
  colorByCommunity: boolean;
  onOpenNode: (id: string) => void;
  onSelectNode: (id: string) => void;
}) {
  const { t } = useTranslation();
  const color = colorByCommunity
    ? communityColor(node.community)
    : (MEMORY_ONTOLOGY_COLORS[node.ontology] ?? "#64748b");

  const backlinkNodes = backlinks
    .map((id) => graphNodes.find((n) => n.id === id))
    .filter(Boolean) as GNode[];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-[color:var(--text-0)]">{node.id}</p>
        <p className="mt-0.5 text-[11px] text-[color:var(--text-2)]">{node.label}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <NodeMetric label={t("graph.ontology")} value={t(`ontologies.${node.ontology}`)} />
        <NodeMetric label={t("graph.collection")} value={node.folder_category ?? "—"} />
        <NodeMetric label={t("graph.importance")} value={node.importance.toFixed(2)} />
        <NodeMetric label={t("graph.decay")} value={node.decay_score.toFixed(2)} />
        <NodeMetric label={t("graph.connections")} value={String(node.degree)} />
        <NodeMetric
          label={t("graph.community")}
          value={node.community !== null ? `#${node.community}` : "—"}
          swatchColor={node.community !== null ? color : undefined}
        />
      </div>

      {node.preview && (
        <div className="rounded-md bg-[color:var(--bg-2)] px-2.5 py-2">
          <p className="text-[10px] leading-relaxed text-[color:var(--text-2)]">
            {node.preview}{node.preview.length >= 160 ? "…" : ""}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenNode(node.id)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t("graph.openInExplorer")}
      </button>

      {backlinkNodes.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1 text-[10px] text-[color:var(--text-2)]">
            <Link2 className="h-3 w-3" />
            <span>{t("graph.linkedFrom", { count: backlinkNodes.length })}</span>
          </div>
          <div className="space-y-1">
            {backlinkNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelectNode(n.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--bg-2)]"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: MEMORY_ONTOLOGY_COLORS[n.ontology] ?? "#64748b" }}
                />
                <span className="truncate text-[10px] text-[color:var(--text-1)]">{n.id}</span>
                <span className="ml-auto shrink-0 text-[9px] text-[color:var(--text-2)]">{n.degree}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeMetric({ label, value, swatchColor }: { label: string; value: string; swatchColor?: string }) {
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
