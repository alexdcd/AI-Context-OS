import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
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
// Constants
// ---------------------------------------------------------------------------

type ViewMode = "cards" | "cosmos";

const COMMUNITY_PALETTE = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#0ea5e9", "#22c55e", "#f43f5e", "#a16207", "#0891b2",
  "#7c3aed", "#059669",
];

const EDGE_COLORS: Record<string, string> = {
  related: "#8a95a6",
  requires: "#9aa8c0",
  optional: "#9c9382",
  wikilink: "#6d9e6d",
  tag: "#7a6d9e",
};

function communityColor(community: number | null): string {
  if (community === null) return "#64748b";
  return COMMUNITY_PALETTE[community % COMMUNITY_PALETTE.length];
}

// Cards mode: width scales with degree
function cardWidth(degree: number): number {
  return 160 + Math.min(degree * 10, 80);
}

// Cosmos mode: radius scales with degree (min 14, max 38)
function cosmosRadius(degree: number): number {
  return Math.max(14, Math.min(14 + degree * 5, 38));
}

// ---------------------------------------------------------------------------
// SVG glyph shapes by ontology — "Semantic Glyphs"
// Each ontology type gets a distinct geometric shape so users can visually
// parse node types at a glance without relying on color alone.
// ---------------------------------------------------------------------------

/** Hexagon path for `source` nodes (raw data / input material). */
function hexagonPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  });
  return `M${pts.join("L")}Z`;
}

/** Rounded-square path for `entity` nodes (concrete, structured). */
function squirclePath(cx: number, cy: number, r: number): string {
  const h = r * 0.85; // half-side
  const cr = r * 0.28; // corner radius
  return `M${cx - h + cr},${cy - h} L${cx + h - cr},${cy - h} Q${cx + h},${cy - h} ${cx + h},${cy - h + cr} L${cx + h},${cy + h - cr} Q${cx + h},${cy + h} ${cx + h - cr},${cy + h} L${cx - h + cr},${cy + h} Q${cx - h},${cy + h} ${cx - h},${cy + h - cr} L${cx - h},${cy - h + cr} Q${cx - h},${cy - h} ${cx - h + cr},${cy - h}Z`;
}

/** Diamond path for `concept` nodes (abstract, ideas). */
function diamondPath(cx: number, cy: number, r: number): string {
  const s = r * 1.1;
  return `M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy}Z`;
}

/** 6-point starburst path for `synthesis` nodes (composed from others). */
function starburstPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  const outer = r * 1.1;
  const inner = r * 0.55;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`);
  }
  return `M${pts.join("L")}Z`;
}

type OntologyShapeFn = (cx: number, cy: number, r: number) => string;
const ONTOLOGY_SHAPES: Record<string, OntologyShapeFn> = {
  source: hexagonPath,
  entity: squirclePath,
  concept: diamondPath,
  synthesis: starburstPath,
};

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

// ---------------------------------------------------------------------------
// Create a d3-force simulation (stays alive for interactive dragging)
// ---------------------------------------------------------------------------

function createSimulation(
  gnodes: GNode[],
  gedges: GraphEdge[],
  mode: ViewMode,
): { simulation: d3.Simulation<SimNode, SimLink>; simNodes: SimNode[] } {
  const simNodes: SimNode[] = gnodes.map((n, i) => ({
    id: n.id,
    x: Math.cos(2 * Math.PI * i / gnodes.length) * 150,
    y: Math.sin(2 * Math.PI * i / gnodes.length) * 150,
  }));

  const nodeSet = new Set(gnodes.map((n) => n.id));
  const simLinks: SimLink[] = gedges
    .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, weight: e.weight ?? 0.5 }));

  const linkDist = mode === "cosmos" ? 90 : 150;
  const charge = mode === "cosmos" ? -220 : -380;
  const collide = mode === "cosmos" ? 52 : 95;

  const simulation = d3.forceSimulation<SimNode, SimLink>(simNodes)
    .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(linkDist).strength((l) => 0.25 + 0.35 * l.weight))
    .force("charge", d3.forceManyBody().strength(charge))
    .force("center", d3.forceCenter(0, 0))
    .force("collide", d3.forceCollide(collide))
    .alphaDecay(0.02)
    .velocityDecay(0.3);

  // Run initial layout to convergence
  simulation.stop().tick(300);

  return { simulation, simNodes };
}

// ---------------------------------------------------------------------------
// Shared node data interface
// ---------------------------------------------------------------------------

interface NodeData extends Record<string, unknown> {
  node: GNode;
  colorByCommunity: boolean;
  godMode: boolean;
  godIds: Set<string>;
  highlighted: boolean;
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
  style?: { stroke?: string; strokeWidth?: number; strokeDasharray?: string };
  labelStyle?: { fill?: string; fontSize?: number };
  animated?: boolean;
}

// ---------------------------------------------------------------------------
// Cards node — detailed rectangle with metadata
// ---------------------------------------------------------------------------

function CardsNode({ data }: { data: NodeData }) {
  const { node: gn, colorByCommunity, godMode, godIds } = data;
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  const isGod = godMode && godIds.has(gn.id);
  const color = isGod ? "#ef4444"
    : colorByCommunity ? communityColor(gn.community)
    : (MEMORY_ONTOLOGY_COLORS[gn.ontology] ?? "#64748b");

  return (
    <div
      style={{ width: cardWidth(gn.degree), opacity: Math.max(0.4, gn.decay_score), position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />
      <div
        className="rounded border border-[var(--border)] bg-[color:var(--bg-1)] px-2.5 py-2"
        style={isGod ? { borderColor: "#ef4444", boxShadow: "0 0 0 1px #ef444440" } : {}}
      >
        <div className="flex items-center gap-1.5">
          {/* Mini ontology glyph */}
          <svg
            className="shrink-0"
            width={10 + Math.min(gn.degree * 1.2, 6)}
            height={10 + Math.min(gn.degree * 1.2, 6)}
            viewBox="0 0 20 20"
          >
            <path
              d={(ONTOLOGY_SHAPES[gn.ontology] ?? ONTOLOGY_SHAPES.entity)(10, 10, 9)}
              fill={color}
              opacity={0.9}
            />
          </svg>
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

      {hovered && gn.preview && (
        <HoverTooltip node={gn} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cosmos node — minimal circle + label (Obsidian-style)
// ---------------------------------------------------------------------------

function CosmosNode({ data }: { data: NodeData }) {
  const { node: gn, colorByCommunity, godMode, godIds, highlighted } = data;
  const [hovered, setHovered] = useState(false);

  const isGod = godMode && godIds.has(gn.id);
  const color = isGod ? "#ef4444"
    : colorByCommunity ? communityColor(gn.community)
    : (MEMORY_ONTOLOGY_COLORS[gn.ontology] ?? "#64748b");

  const active = hovered || highlighted;
  const r = cosmosRadius(gn.degree);
  const svgSize = (r + 6) * 2; // extra space for ring + glow filter
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  // Importance ring: SVG circle that fills proportionally (0-1)
  const ringR = r + 3;
  const ringCircum = 2 * Math.PI * ringR;
  const ringFill = gn.importance * ringCircum;

  // Shape path based on ontology
  const shapeFn = ONTOLOGY_SHAPES[gn.ontology] ?? ONTOLOGY_SHAPES.entity;
  const shapePath = shapeFn(cx, cy, r);

  // Decay drives pulse: fresh nodes (>0.7) pulse, stale ones are static
  const shouldPulse = gn.decay_score > 0.7 && !isGod;

  // Unique gradient id per node
  const gradId = `grad-${gn.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const glowId = `glow-${gn.id.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div
      style={{
        width: svgSize + 80,
        opacity: Math.max(0.35, gn.decay_score),
        position: "relative",
        transition: "transform 0.2s ease, opacity 0.2s ease",
        transform: active ? "scale(1.12)" : "scale(1)",
        zIndex: active ? 10 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-2 !h-2" />

      {/* SVG Semantic Glyph */}
      <div className="flex justify-center">
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          style={{ overflow: "visible" }}
        >
          <defs>
            {/* Radial gradient for depth */}
            <radialGradient id={gradId} cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor={color} stopOpacity="1" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </radialGradient>
            {/* Glow filter */}
            <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={active ? 6 : 3} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Importance ring (background track) */}
          <circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={color}
            strokeOpacity={0.15}
            strokeWidth={2}
          />

          {/* Importance ring (filled arc) */}
          <circle
            cx={cx}
            cy={cy}
            r={ringR}
            fill="none"
            stroke={color}
            strokeOpacity={active ? 0.9 : 0.6}
            strokeWidth={2}
            strokeDasharray={`${ringFill} ${ringCircum - ringFill}`}
            strokeDashoffset={ringCircum * 0.25}
            strokeLinecap="round"
            style={{ transition: "stroke-opacity 0.3s ease" }}
          />

          {/* God node outer ring */}
          {isGod && (
            <circle
              cx={cx}
              cy={cy}
              r={ringR + 2}
              fill="none"
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeOpacity={0.7}
              className="cosmos-glyph-god-ring"
            />
          )}

          {/* Main shape */}
          <path
            d={shapePath}
            fill={`url(#${gradId})`}
            filter={`url(#${glowId})`}
            opacity={active ? 1 : 0.85}
            className={shouldPulse ? "cosmos-glyph-pulse" : undefined}
            style={{ transition: "opacity 0.25s ease" }}
          />

          {/* Inner highlight (glass effect) */}
          <path
            d={shapePath}
            fill="none"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
          />
        </svg>
      </div>

      {/* Ontology micro-badge */}
      <div
        className="mx-auto mt-0.5 w-fit rounded-full px-1.5 py-px text-center"
        style={{
          fontSize: 8,
          color: color,
          backgroundColor: `${color}18`,
          opacity: active ? 1 : 0.7,
          transition: "opacity 0.2s ease",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {gn.ontology}
      </div>

      {/* Label below glyph */}
      <div
        className="mt-0.5 text-center font-medium leading-tight"
        style={{
          fontSize: active ? 13 : Math.max(9, Math.min(10 + gn.degree, 12)),
          maxWidth: svgSize + 80,
          overflow: active ? "visible" : "hidden",
          display: "-webkit-box",
          WebkitLineClamp: active ? 4 : 2,
          WebkitBoxOrient: "vertical",
          color: active ? "var(--text-0)" : "var(--text-1)",
          textShadow: active ? "0 1px 6px rgba(0,0,0,0.9)" : "0 1px 3px rgba(0,0,0,0.8)",
          transition: "font-size 0.2s ease, color 0.2s ease",
        }}
      >
        {gn.label || gn.id}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-2 !h-2" />

      {hovered && gn.preview && (
        <HoverTooltip node={gn} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared hover tooltip
// ---------------------------------------------------------------------------

function HoverTooltip({ node: gn }: { node: GNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-60 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[color:var(--bg-2)] px-3 py-2 shadow-lg"
    >
      <p className="text-[11px] font-medium text-[color:var(--text-0)]">{gn.label}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-[color:var(--text-2)]">
        {gn.preview}{gn.preview.length >= 160 ? "…" : ""}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[9px] text-[color:var(--text-2)]">
        <span>{t(`ontologies.${gn.ontology}`)}</span>
        {gn.degree > 0 && <span>{t("graph.links", { count: gn.degree })}</span>}
      </div>
    </div>
  );
}

const nodeTypes = {
  cards: CardsNode,
  cosmos: CosmosNode,
};

// ---------------------------------------------------------------------------
// View mode switcher button group
// ---------------------------------------------------------------------------

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex rounded border border-[var(--border)] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange("cards")}
        className={clsx(
          "flex items-center gap-1 px-2 py-1 text-[10px] transition-colors",
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
          "flex items-center gap-1 px-2 py-1 text-[10px] transition-colors border-l border-[var(--border)]",
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
  const { graphData, loadGraph, selectFile, setError } = useAppStore();
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
    setSelectedNode(graphData.nodes.find((n) => n.id === selectedNode.id) ?? null);
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

  // Compute which node IDs are neighbors of the hovered node
  const highlightedIds = useMemo<Set<string>>(() => {
    if (!hoveredNodeId) return new Set();
    const ids = new Set<string>([hoveredNodeId]);
    for (const e of filteredData.edges) {
      if (e.source === hoveredNodeId) ids.add(e.target);
      if (e.target === hoveredNodeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, filteredData.edges]);

  // Build flow nodes/edges from simulation positions
  const buildFlowData = useCallback((simNodes: SimNode[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of simNodes) positions[n.id] = { x: n.x ?? 0, y: n.y ?? 0 };

    const newNodes: FlowNode[] = filteredData.nodes.map((node) => {
      const isCards = viewMode === "cards";
      const w = isCards ? cardWidth(node.degree) : (cosmosRadius(node.degree) * 2 + 80);
      return {
        id: node.id,
        type: viewMode,
        position: positions[node.id] ?? { x: 0, y: 0 },
        style: { width: w },
        data: { node, colorByCommunity, godMode, godIds, highlighted: highlightedIds.has(node.id) },
      };
    });

    const newEdges: FlowEdge[] = filteredData.edges.map((edge, i) => {
      const isHighlighted = highlightedIds.has(edge.source) && highlightedIds.has(edge.target);
      return {
        id: `e-${edge.source}-${edge.target}-${i}`,
        source: edge.source,
        target: edge.target,
        label: edge.edge_type !== "tag" ? edge.edge_type : undefined,
        animated: edge.edge_type === "requires" || isHighlighted,
        style: {
          stroke: isHighlighted ? "#fff" : (EDGE_COLORS[edge.edge_type] ?? "#6b7280"),
          strokeWidth: isHighlighted
            ? Math.max(1.5, (edge.weight ?? 0.5) * 3)
            : viewMode === "cosmos"
              ? Math.max(0.5, (edge.weight ?? 0.5) * 2)
              : Math.max(0.8, (edge.weight ?? 0.5) * 2.5),
          strokeDasharray: edge.edge_type === "tag" && !isHighlighted ? "4 3" : undefined,
        },
        labelStyle: { fill: isHighlighted ? "#fff" : "#8b9cb4", fontSize: isHighlighted ? 10 : 9 },
      };
    });

    return { newNodes, newEdges };
  }, [filteredData, viewMode, colorByCommunity, godMode, godIds, highlightedIds]);

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

    const { newNodes, newEdges } = buildFlowData(simNodes);
    setNodes(newNodes);
    setEdges(newEdges);

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
            if (
              flowNode.position.x === nextPosition.x
              && flowNode.position.y === nextPosition.y
            ) {
              return flowNode;
            }
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

  // Update node data (highlight, colors) without recomputing layout
  useEffect(() => {
    if (simNodesRef.current.length === 0) return;
    const { newNodes, newEdges } = buildFlowData(simNodesRef.current);
    setNodes(newNodes);
    setEdges(newEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedIds, colorByCommunity, godMode, godIds]);

  // Fit view after layout completes or when flowInstance becomes available
  useEffect(() => {
    if (flowInstance && nodes.length > 0 && !layouting) {
      requestAnimationFrame(() => flowInstance.fitView({ padding: 0.15, duration: 400 }));
    }
  }, [flowInstance, nodes.length, layouting]);

  // --- Interactive drag: pin dragged node, reheat simulation, update positions ---
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const sim = simulationRef.current;
    if (!sim) return;
    draggedNodeIdRef.current = node.id;
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) {
      simNode.fx = node.position.x;
      simNode.fy = node.position.y;
    }
    sim.alphaTarget(0.3).restart();
  }, []);

  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) {
      simNode.fx = node.position.x;
      simNode.fy = node.position.y;
    }
  }, []);

  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const sim = simulationRef.current;
    if (!sim) return;
    const simNode = simNodeMapRef.current.get(node.id);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
    }
    draggedNodeIdRef.current = null;
    sim.alphaTarget(0);
  }, []);

  // --- Hover highlighting ---
  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: FlowNode) => {
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
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
            {(["source", "entity", "concept", "synthesis"] as MemoryOntology[]).map((o) => (
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
            <span className="w-5 text-right font-mono text-[10px] text-[color:var(--text-2)]">
              {minImportance.toFixed(1)}
            </span>
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

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
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
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onInit={setFlowInstance}
              nodeTypes={nodeTypes}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              {viewMode === "cosmos" ? (
                <Background color="rgba(255,255,255,0.025)" gap={32} size={1} />
              ) : (
                <Background color="rgba(255,255,255,0.03)" gap={24} />
              )}
              <Controls />
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
