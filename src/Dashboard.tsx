import { useMemo, useState, type ReactNode } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch, Layers3, Network } from "lucide-react";
import {
  buildGraphModel,
  DEFAULT_FLOW_LANES,
  getCrossRegionGroups,
  getFlowLayout,
  getFocusView,
  type FlowLayoutModel,
  type FlowStageModel,
  type GraphModel,
  type GraphNode,
  type VisualEdge
} from "./graphBuilder";
import {
  buildOverlayModel,
  resolveEdgeOverlay,
  resolveNodeOverlay,
  type OverlayModel,
  type ResolvedEdgeOverlay,
  type ResolvedNodeOverlay
} from "./overlays";
import type {
  ArchitectureOverlays,
  ArchitectureManifest,
  ArchitectureView,
  CrossRegionView as CrossRegionViewManifest,
  FocusView as FocusViewManifest,
  OverlayMetric,
  RegionView as RegionViewManifest
} from "./zod";
import { EMPTY_ARCHITECTURE_OVERLAYS as EMPTY_OVERLAYS } from "./zod";
import type { OverlayRuntimeStatus } from "./runtime/types";

interface DashboardProps {
  manifest: ArchitectureManifest;
  overlays?: ArchitectureOverlays;
  runtimeInfo?: {
    overlayRevision: number;
    overlayGeneratedAt: string;
    overlaySource: string;
    overlayStatus: OverlayRuntimeStatus;
    previewActive?: boolean;
  };
  toolbarSlot?: ReactNode;
}

const STAGE_WIDTH = 166;
const STAGE_GAP = 64;
const LANE_HEIGHT = 240;
const CANVAS_MARGIN_X = 172;
const CANVAS_MARGIN_Y = 28;
const STAGE_HEADER_HEIGHT = 38;
const NODE_HEIGHT = 92;
const NODE_GAP = 14;
const SLOW_EDGE_TYPES = new Set(["sideline", "drain", "replay"]);
const READ_EDGE_TYPES = new Set(["serve"]);
const NODE_TYPES = { topology: TopologyNode };
const EDGE_TYPES = { topology: TopologyEdge };
const FLOW_MIN_ZOOM = 0.15;
const FLOW_MAX_ZOOM = 2.25;
const FLOW_FIT_VIEW_OPTIONS = { padding: 0.16 };

interface EdgeOverlayData {
  tone?: "default" | "primary" | "secondary" | "cross" | "read";
  thickness?: number;
  warning?: boolean;
  tooltip?: string;
}

interface TopologyNodeData extends Record<string, unknown> {
  node: GraphNode;
  overlay?: ResolvedNodeOverlay;
  onToggle: (nodeId: string, collapsed: boolean) => void;
  focusState?: "source" | "target" | "selected" | "incoming" | "outgoing" | "dimmed";
}

interface TopologyEdgeData extends Record<string, unknown> {
  edge: VisualEdge;
  overlay?: EdgeOverlayData;
  resolvedOverlay?: ResolvedEdgeOverlay;
  focusState?: "selected" | "incoming" | "outgoing" | "dimmed";
  routeOffset?: number;
}

type TopologyFlowNode = Node<TopologyNodeData, "topology">;
type TopologyFlowEdge = Edge<TopologyEdgeData, "topology">;
type CrossRegionGroupModel = ReturnType<typeof getCrossRegionGroups>[number];
type EdgeAnnotationKind = "edge" | "route";

interface EdgeAnnotation {
  id: string;
  kind: EdgeAnnotationKind;
  title: string;
  chips: string[];
  warning?: boolean;
}

interface SelectedNodeDetail {
  node: GraphNode;
  incomingEdges: VisualEdge[];
  outgoingEdges: VisualEdge[];
}

const NOOP_TOGGLE = () => undefined;
const CROSS_REGION_TARGET_Y = {
  aggregate: 96,
  partner: 226,
  regionGap: 200
};

function nodeLabel(model: GraphModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
}

function edgeTone(edge: VisualEdge, overlay?: EdgeOverlayData): string {
  if (overlay?.tone) {
    return overlay.tone;
  }
  if (edge.emphasis === "primary") {
    return "primary";
  }
  if (edge.emphasis === "secondary" || SLOW_EDGE_TYPES.has(edge.type)) {
    return "secondary";
  }
  if (READ_EDGE_TYPES.has(edge.type)) {
    return "read";
  }
  if (edge.crossRegion) {
    return "cross";
  }
  return "default";
}

function edgeKey(edge: VisualEdge): string {
  return `${edge.visibleFrom}-${edge.visibleTo}-${edge.type}-${edge.emphasis}-${edge.sourceEdgeIds.join(".")}`;
}

function flowEdgeId(edge: VisualEdge): string {
  return edge.sourceEdgeIds.length === 1 ? edge.sourceEdgeIds[0] : `rollup:${edge.sourceEdgeIds.join("+")}`;
}

function laneIndex(lanes: { id: string }[], lane: string): number {
  const index = lanes.findIndex((candidate) => candidate.id === lane);
  return index >= 0 ? index : lanes.length;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function formatMetricChip(metric: OverlayMetric): string {
  const label = metric.label.toLowerCase();
  if (label === "instance" || label === "instance type") {
    return String(metric.value);
  }
  return `${metric.value} ${metric.label}`;
}

function decoratorAnnotationChips(decorator: {
  metric_label?: string;
  badges: string[];
  metrics: OverlayMetric[];
}): string[] {
  return uniqueStrings([
    ...(decorator.metric_label ? [decorator.metric_label] : []),
    ...decorator.badges,
    ...decorator.metrics.map(formatMetricChip)
  ]);
}

function buildEdgeAnnotations(resolved?: ResolvedEdgeOverlay): EdgeAnnotation[] {
  if (!resolved) {
    return [];
  }

  const edgeAnnotations = resolved.edgeDecorators.map((decorator) => ({
    id: decorator.id,
    kind: "edge" as const,
    title: decorator.title ?? decorator.id,
    chips: decoratorAnnotationChips(decorator),
    warning: decorator.warning
  }));
  const routeAnnotations = resolved.routeDecorators.map((decorator) => ({
    id: decorator.id,
    kind: "route" as const,
    title: decorator.title ?? decorator.id,
    chips: decoratorAnnotationChips(decorator),
    warning: decorator.warning
  }));

  return [...edgeAnnotations, ...routeAnnotations];
}

function edgeOverlayLabelChips(resolved?: ResolvedEdgeOverlay): string[] {
  return uniqueStrings(buildEdgeAnnotations(resolved).flatMap((annotation) => annotation.chips)).slice(0, 3);
}

function presentationOverlayFromResolved(resolved?: ResolvedEdgeOverlay): EdgeOverlayData | undefined {
  if (!resolved) {
    return undefined;
  }

  return {
    tone: resolved.tone,
    thickness: resolved.thickness,
    warning: resolved.warning,
    tooltip: resolved.tooltip
  };
}

function mergeEdgeOverlays(fallback?: EdgeOverlayData, resolved?: EdgeOverlayData): EdgeOverlayData | undefined {
  if (!fallback) {
    return resolved;
  }
  if (!resolved) {
    return fallback;
  }

  return {
    tone: resolved.tone ?? fallback.tone,
    thickness: resolved.thickness ?? fallback.thickness,
    warning: Boolean(fallback.warning || resolved.warning),
    tooltip: resolved.tooltip ?? fallback.tooltip
  };
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <section className="error-panel" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <div>
        <h1>{title}</h1>
        <pre>{message}</pre>
      </div>
    </section>
  );
}

function CollapseButton({
  node,
  onToggle
}: {
  node: GraphNode;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="collapse-button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(node.id, !node.isCollapsed);
      }}
      aria-label={`${node.isCollapsed ? "Expand" : "Collapse"} ${node.label}`}
    >
      {node.isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
      {node.isCollapsed ? "Expand" : "Collapse"}
    </button>
  );
}

function NodeCard({
  node,
  overlay,
  onToggle,
  focusState
}: {
  node: GraphNode;
  overlay?: ResolvedNodeOverlay;
  onToggle: (nodeId: string, collapsed: boolean) => void;
  focusState?: TopologyNodeData["focusState"];
}) {
  return (
    <article className={`node-card type-${node.type} ${focusState ? `is-${focusState}` : ""}`} title={overlay?.tooltip}>
      <div>
        <strong>{node.label}</strong>
        <span>{node.id}</span>
      </div>
      {overlay?.chips.length ? (
        <div className="node-overlay-chips" aria-label={`${node.label} overlay metrics`}>
          {overlay.chips.slice(0, 3).map((chip) => (
            <b key={chip}>{chip}</b>
          ))}
        </div>
      ) : null}
      <small>{node.type}</small>
      {node.isGroup ? <CollapseButton node={node} onToggle={onToggle} /> : null}
    </article>
  );
}

function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  return (
    <>
      <Handle className="flow-handle" type="target" position={Position.Left} />
      <NodeCard node={data.node} overlay={data.overlay} onToggle={data.onToggle} focusState={data.focusState} />
      <Handle className="flow-handle" type="source" position={Position.Right} />
    </>
  );
}

function edgeTooltip(edge: VisualEdge): string {
  return [
    edge.label ?? edge.type,
    `${uniqueOriginalValues(edge, "from")} -> ${uniqueOriginalValues(edge, "to")}`,
    `${uniqueOriginalValues(edge, "sourceRegion")} -> ${uniqueOriginalValues(edge, "destinationRegion")}`,
    edge.crossRegion ? "cross_region: true" : "cross_region: false"
  ].join("\n");
}

function TopologyEdge(props: EdgeProps<TopologyFlowEdge>) {
  const edge = props.data?.edge;
  const overlay = props.data?.overlay;
  const resolvedOverlay = props.data?.resolvedOverlay;
  const focusState = props.data?.focusState;
  const routeOffset = props.data?.routeOffset ?? 0;
  const route = getEdgeRoute({
    edge,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    routeOffset
  });

  if (!edge) {
    return <BaseEdge id={props.id} path={route.path} markerEnd={props.markerEnd} interactionWidth={24} />;
  }

  const label = edge.label ?? edge.type;
  const tone = edgeTone(edge, overlay);
  const overlayLabelChips = edgeOverlayLabelChips(resolvedOverlay);

  return (
    <>
      <BaseEdge
        id={props.id}
        path={route.path}
        markerEnd={props.markerEnd}
        interactionWidth={28}
        className={`topology-edge tone-${tone} ${props.selected ? "is-selected" : ""} ${focusState ? `is-${focusState}` : ""} ${overlay?.warning ? "is-warning" : ""}`}
        style={{ ...props.style, strokeWidth: overlay?.thickness }}
        data-testid={`flow-edge-${props.id}`}
      />
      <EdgeLabelRenderer>
        <div
          className={`edge-label tone-${tone} ${overlayLabelChips.length ? "has-overlay-chips" : ""} ${props.selected ? "is-selected" : ""} ${focusState ? `is-${focusState}` : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)` }}
          title={overlay?.tooltip ?? edgeTooltip(edge)}
        >
          <span className="edge-label-text">{label}</span>
          {overlayLabelChips.length ? (
            <span className="edge-label-overlay-chips" aria-label={`${label} overlay labels`}>
              {overlayLabelChips.map((chip) => (
                <b key={chip}>{chip}</b>
              ))}
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function EdgeRow({ edge, model }: { edge: VisualEdge; model: GraphModel }) {
  const sourceLabel = nodeLabel(model, edge.visibleFrom);
  const targetLabel = nodeLabel(model, edge.visibleTo);
  const rolledUp = edge.sourceEdgeIds.length > 1 || edge.originalFrom !== edge.visibleFrom || edge.originalTo !== edge.visibleTo;

  return (
    <article className={`edge-row ${edge.crossRegion ? "cross-region" : ""} emphasis-${edge.emphasis}`}>
      <div className="edge-route">
        <strong>{sourceLabel}</strong>
        <ChevronRight size={16} aria-hidden="true" />
        <strong>{targetLabel}</strong>
      </div>
      <div className="edge-meta">
        <span>{edge.label ?? edge.type}</span>
        <span>{uniqueOriginalValues(edge, "sourceRegion")} to {uniqueOriginalValues(edge, "destinationRegion")}</span>
        <span>{edge.sourceEdgeIds.join(", ")}</span>
        {rolledUp ? <span>rolled up from original endpoints</span> : null}
      </div>
    </article>
  );
}

function EdgePanel({ title, edges, model }: { title: string; edges: VisualEdge[]; model: GraphModel }) {
  return (
    <section className="edge-panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <span>{edges.length} edges</span>
      </div>
      <div className="edge-list">
        {edges.map((edge) => (
          <EdgeRow key={edgeKey(edge)} edge={edge} model={model} />
        ))}
      </div>
    </section>
  );
}

interface FlowPoint {
  left: number;
  top: number;
}

function getStagePosition(stageIndex: number, lane: string, lanes: { id: string }[]): { left: number; top: number } {
  return {
    left: CANVAS_MARGIN_X + stageIndex * (STAGE_WIDTH + STAGE_GAP),
    top: CANVAS_MARGIN_Y + laneIndex(lanes, lane) * LANE_HEIGHT
  };
}

function buildNodePositions(stages: FlowStageModel[], lanes: { id: string }[]): Map<string, FlowPoint> {
  const positions = new Map<string, FlowPoint>();

  stages.forEach((stage, stageIndex) => {
    const { left, top } = getStagePosition(stageIndex, stage.lane, lanes);
    stage.nodes.forEach((node, nodeIndex) => {
      if (positions.has(node.id)) {
        return;
      }
      positions.set(node.id, {
        left,
        top: top + STAGE_HEADER_HEIGHT + nodeIndex * (NODE_HEIGHT + NODE_GAP)
      });
    });
  });

  return positions;
}

function buildFlowElements(
  layout: FlowLayoutModel,
  overlayModel: OverlayModel,
  onToggle: (nodeId: string, collapsed: boolean) => void,
  selectedEdgeId?: string,
  selectedNodeId?: string
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const nodePositions = buildNodePositions(layout.stages, layout.lanes);
  const visibleEdges = layout.edges.filter((edge) => nodePositions.has(edge.visibleFrom) && nodePositions.has(edge.visibleTo));
  const selectedEdge = visibleEdges.find((edge) => flowEdgeId(edge) === selectedEdgeId);
  const routeOffsets = buildRouteOffsets(visibleEdges);
  const seenNodeIds = new Set<string>();
  const nodes = layout.stages.flatMap<TopologyFlowNode>((stage) =>
    stage.nodes.flatMap((node) => {
      const position = nodePositions.get(node.id);
      if (!position || seenNodeIds.has(node.id)) {
        return [];
      }
      seenNodeIds.add(node.id);
      return [
        makeFlowNode(
          node,
          position,
          onToggle,
          nodeFocusState(node.id, selectedEdge, selectedNodeId, visibleEdges),
          resolveNodeOverlay(overlayModel, node.id)
        )
      ];
    })
  );

  const edges = visibleEdges
    .map<TopologyFlowEdge>((edge) => {
      const id = flowEdgeId(edge);
      const resolvedOverlay = resolveEdgeOverlay(overlayModel, edge);
      const focusState = edgeFocusState(id, edge, selectedEdgeId, selectedNodeId);
      return {
        id,
        type: "topology",
        source: edge.visibleFrom,
        target: edge.visibleTo,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          edge,
          overlay: presentationOverlayFromResolved(resolvedOverlay),
          resolvedOverlay,
          focusState,
          routeOffset: routeOffsets.get(id) ?? 0
        },
        selected: id === selectedEdgeId,
        zIndex: focusZIndex(focusState),
        focusable: true,
        selectable: true,
        reconnectable: false,
        ariaRole: "button"
      };
    });

  return { nodes, edges };
}

function buildRouteOffsets(edges: VisualEdge[]): Map<string, number> {
  const groups = new Map<string, VisualEdge[]>();

  for (const edge of edges) {
    if (!SLOW_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const endpoint = edge.type === "replay" ? edge.visibleFrom : edge.visibleTo;
    const key = `${edge.type}:${endpoint}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  const offsets = new Map<string, number>();
  for (const groupedEdges of groups.values()) {
    if (groupedEdges.length < 2) {
      continue;
    }
    const sortedEdges = [...groupedEdges].sort((left, right) => flowEdgeId(left).localeCompare(flowEdgeId(right)));
    sortedEdges.forEach((edge, index) => {
      offsets.set(flowEdgeId(edge), (index - (sortedEdges.length - 1) / 2) * 38);
    });
  }
  return offsets;
}

function makeFlowNode(
  node: GraphNode,
  position: FlowPoint,
  onToggle: (nodeId: string, collapsed: boolean) => void,
  focusState?: TopologyNodeData["focusState"],
  overlay?: ResolvedNodeOverlay
): TopologyFlowNode {
  return {
    id: node.id,
    type: "topology",
    position: { x: position.left, y: position.top },
    data: { node, overlay, onToggle, focusState },
    width: STAGE_WIDTH,
    height: NODE_HEIGHT,
    initialWidth: STAGE_WIDTH,
    initialHeight: NODE_HEIGHT,
    measured: { width: STAGE_WIDTH, height: NODE_HEIGHT },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    handles: [
      { id: null, type: "target", position: Position.Left, x: 0, y: NODE_HEIGHT / 2, width: 1, height: 1 },
      { id: null, type: "source", position: Position.Right, x: STAGE_WIDTH, y: NODE_HEIGHT / 2, width: 1, height: 1 }
    ],
    style: { width: STAGE_WIDTH, height: NODE_HEIGHT },
    className: focusState ? `is-${focusState}` : undefined,
    zIndex: focusState && focusState !== "dimmed" ? 20 : 0,
    draggable: false,
    focusable: true,
    selectable: true,
    ariaRole: "button"
  };
}

function nodeFocusState(
  nodeId: string,
  selectedEdge?: VisualEdge,
  selectedNodeId?: string,
  visibleEdges: VisualEdge[] = []
): TopologyNodeData["focusState"] {
  if (selectedEdge) {
    if (nodeId === selectedEdge.visibleFrom) {
      return "source";
    }
    if (nodeId === selectedEdge.visibleTo) {
      return "target";
    }
    return "dimmed";
  }

  if (!selectedNodeId) {
    return undefined;
  }
  if (nodeId === selectedNodeId) {
    return "selected";
  }
  const hasIncoming = visibleEdges.some((edge) => edge.visibleFrom === nodeId && edge.visibleTo === selectedNodeId);
  const hasOutgoing = visibleEdges.some((edge) => edge.visibleFrom === selectedNodeId && edge.visibleTo === nodeId);
  if (hasOutgoing) {
    return "outgoing";
  }
  if (hasIncoming) {
    return "incoming";
  }
  return "dimmed";
}

function edgeFocusState(
  edgeId: string,
  edge: VisualEdge,
  selectedEdgeId?: string,
  selectedNodeId?: string
): TopologyEdgeData["focusState"] {
  if (selectedEdgeId) {
    return edgeId === selectedEdgeId ? "selected" : "dimmed";
  }
  if (!selectedNodeId) {
    return undefined;
  }
  if (edge.visibleFrom === selectedNodeId) {
    return "outgoing";
  }
  if (edge.visibleTo === selectedNodeId) {
    return "incoming";
  }
  return "dimmed";
}

function focusZIndex(focusState?: TopologyEdgeData["focusState"]): number {
  if (focusState === "selected") {
    return 20;
  }
  if (focusState === "incoming" || focusState === "outgoing") {
    return 18;
  }
  return 0;
}

function miniMapNodeColor(node: TopologyFlowNode): string {
  switch (node.data.node.type) {
    case "group":
      return "#2e2350";
    case "stream":
      return "#123f5a";
    case "router":
    case "indexer":
    case "processor":
      return "#123926";
    case "queue":
      return "#4a3610";
    case "cluster":
      return "#102c38";
    case "api":
      return "#34345d";
    default:
      return "#132636";
  }
}

function InteractiveFlowCanvas({
  className,
  testId,
  nodes,
  edges,
  children,
  onNodeClick,
  onEdgeClick,
  onPaneClick
}: {
  className: string;
  testId: string;
  nodes: TopologyFlowNode[];
  edges: TopologyFlowEdge[];
  children?: ReactNode;
  onNodeClick: (nodeId: string) => void;
  onEdgeClick: (edgeId: string) => void;
  onPaneClick: () => void;
}) {
  return (
    <div className={`interactive-flow-canvas ${className}`} data-testid={testId}>
      <ReactFlow<TopologyFlowNode, TopologyFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick
        preventScrolling={false}
        minZoom={FLOW_MIN_ZOOM}
        maxZoom={FLOW_MAX_ZOOM}
        fitView
        fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        onEdgeClick={(_, edge) => onEdgeClick(edge.id)}
        onPaneClick={onPaneClick}
      >
        <Background gap={28} color="rgba(143, 170, 190, 0.14)" />
        <ViewportPortal>{children}</ViewportPortal>
        <MiniMap
          aria-label="Graph overview"
          nodeColor={miniMapNodeColor}
          nodeStrokeColor="rgba(232, 241, 247, 0.7)"
          maskColor="rgba(7, 16, 23, 0.68)"
          pannable
          zoomable
        />
        <Controls
          aria-label="Graph zoom controls"
          position="bottom-left"
          showInteractive={false}
          fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
        />
      </ReactFlow>
    </div>
  );
}

function getEdgeRoute({
  edge,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  routeOffset
}: {
  edge?: VisualEdge;
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  routeOffset: number;
}): { path: string; labelX: number; labelY: number } {
  if (!edge || !SLOW_EDGE_TYPES.has(edge.type) || routeOffset === 0) {
    const [path, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: edge && SLOW_EDGE_TYPES.has(edge.type) ? 0.3 : 0.5
    });
    return { path, labelX, labelY };
  }

  const direction = targetX >= sourceX ? 1 : -1;
  const handleDistance = Math.max(Math.abs(targetX - sourceX) * 0.45, 96);
  const sourceControlY = sourceY + routeOffset;
  const targetControlY = targetY + routeOffset;

  return {
    path: [
      `M ${sourceX},${sourceY}`,
      `C ${sourceX + direction * handleDistance},${sourceControlY}`,
      `${targetX - direction * handleDistance},${targetControlY}`,
      `${targetX},${targetY}`
    ].join(" "),
    labelX: (sourceX + targetX) / 2,
    labelY: (sourceY + targetY) / 2 + routeOffset
  };
}

function crossRegionOverlay(edge: VisualEdge, model: GraphModel): EdgeOverlayData {
  const source = model.nodeById.get(edge.originalFrom);
  const target = model.nodeById.get(edge.originalTo);

  if (edge.type === "replay") {
    return { tone: "secondary", thickness: 3 };
  }
  if (edge.type === "publish" && source?.zone === "hot" && target?.zone === "partner") {
    return { tone: "primary", thickness: 3.6 };
  }
  if (edge.type === "publish" && target?.zone === "aggregate") {
    return { tone: "cross", thickness: 3 };
  }
  return { tone: "cross", thickness: 3 };
}

function targetYFor(node: GraphNode, regionIndex: number): number {
  const rowOffset = regionIndex * CROSS_REGION_TARGET_Y.regionGap;
  return rowOffset + (node.zone === "aggregate" ? CROSS_REGION_TARGET_Y.aggregate : CROSS_REGION_TARGET_Y.partner);
}

function crossRegionSourceNodes(model: GraphModel, groups: CrossRegionGroupModel[]): GraphNode[] {
  const zoneOrder = new Map(["pre_aggregate", "hot", "partner"].map((zone, index) => [zone, index]));
  const sourceIds = Array.from(new Set(groups.flatMap((group) => group.edges.map((edge) => edge.visibleFrom))));
  return sourceIds
    .flatMap((id) => {
      const node = model.nodeById.get(id);
      return node ? [node] : [];
    })
    .sort((left, right) => {
      const leftRank = zoneOrder.get(left.zone) ?? zoneOrder.size;
      const rightRank = zoneOrder.get(right.zone) ?? zoneOrder.size;
      return leftRank - rightRank || left.label.localeCompare(right.label);
    });
}

function buildCrossRegionRouteMap(
  model: GraphModel,
  overlayModel: OverlayModel,
  groups: CrossRegionGroupModel[],
  selectedEdgeId?: string,
  selectedNodeId?: string
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[]; regions: { id: string; left: number; top: number }[] } {
  const sourceX = 40;
  const destinationStartX = 380;
  const destinationGap = 320;
  const visibleEdges = groups.flatMap((group) => group.edges);
  const selectedEdge = visibleEdges.find((edge) => flowEdgeId(edge) === selectedEdgeId);
  const routeOffsets = buildRouteOffsets(visibleEdges);
  const regions = groups.map((group, index) => ({
    id: group.destinationRegion,
    left: destinationStartX + index * destinationGap,
    top: 24 + index * CROSS_REGION_TARGET_Y.regionGap
  }));
  const nodeById = new Map<string, TopologyFlowNode>();
  const sourceNodes = crossRegionSourceNodes(model, groups);

  sourceNodes.forEach((node, index) => {
    nodeById.set(
      node.id,
      makeFlowNode(
        node,
        { left: sourceX, top: 96 + index * 130 },
        NOOP_TOGGLE,
        nodeFocusState(node.id, selectedEdge, selectedNodeId, visibleEdges),
        resolveNodeOverlay(overlayModel, node.id)
      )
    );
  });

  groups.forEach((group, groupIndex) => {
    const left = destinationStartX + groupIndex * destinationGap;
    for (const edge of group.edges) {
      const target = model.nodeById.get(edge.visibleTo);
      if (target) {
        nodeById.set(
          target.id,
          makeFlowNode(
            target,
            { left, top: targetYFor(target, groupIndex) },
            NOOP_TOGGLE,
            nodeFocusState(target.id, selectedEdge, selectedNodeId, visibleEdges),
            resolveNodeOverlay(overlayModel, target.id)
          )
        );
      }
    }
  });

  const edges = groups.flatMap((group) =>
    group.edges.map<TopologyFlowEdge>((edge) => {
      const id = flowEdgeId(edge);
      const resolvedOverlay = resolveEdgeOverlay(overlayModel, edge);
      const focusState = edgeFocusState(id, edge, selectedEdgeId, selectedNodeId);
      return {
        id,
        type: "topology",
        source: edge.visibleFrom,
        target: edge.visibleTo,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          edge,
          overlay: mergeEdgeOverlays(crossRegionOverlay(edge, model), presentationOverlayFromResolved(resolvedOverlay)),
          resolvedOverlay,
          focusState,
          routeOffset: routeOffsets.get(id) ?? 0
        },
        selected: id === selectedEdgeId,
        zIndex: focusZIndex(focusState),
        focusable: true,
        selectable: true,
        reconnectable: false,
        ariaRole: "button"
      };
    })
  );

  return {
    nodes: [...nodeById.values()],
    edges,
    regions
  };
}

function uniqueOriginalValues(edge: VisualEdge, field: "from" | "to" | "sourceRegion" | "destinationRegion"): string {
  return Array.from(new Set(edge.originalEdges.map((original) => original[field]))).join(", ");
}

function EdgeDetailPanel({
  edge,
  overlay,
  model,
  onClose
}: {
  edge: VisualEdge;
  overlay?: ResolvedEdgeOverlay;
  model: GraphModel;
  onClose: () => void;
}) {
  const fields = [
    ["originalFrom", uniqueOriginalValues(edge, "from")],
    ["originalTo", uniqueOriginalValues(edge, "to")],
    ["visibleFrom", edge.visibleFrom],
    ["visibleTo", edge.visibleTo],
    ["type", edge.type],
    ["label", edge.label ?? ""],
    ["sourceRegion", uniqueOriginalValues(edge, "sourceRegion")],
    ["destinationRegion", uniqueOriginalValues(edge, "destinationRegion")],
    ["cross_region", String(edge.crossRegion)],
    ["sourceEdgeIds", edge.sourceEdgeIds.join(", ")]
  ];
  const overlayFields = overlay
    ? [
        ["overlayDecorators", overlay.edgeDecorators.map((decorator) => decorator.id).join(", ")],
        ["routeDecorators", overlay.routeDecorators.map((decorator) => decorator.id).join(", ")],
        ["overlayBadges", overlay.badges.join(", ")],
        ["overlayMetrics", overlay.metrics.map(formatMetricChip).join(", ")]
      ]
    : [];
  const annotations = buildEdgeAnnotations(overlay);

  return (
    <aside className="selected-edge-panel" aria-label="Selected edge details">
      <div className="panel-heading">
        <div>
          <h2>Selected edge</h2>
          <p>{nodeLabel(model, edge.visibleFrom)} to {nodeLabel(model, edge.visibleTo)}</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {annotations.length ? (
        <section className="selected-edge-annotations" aria-label="Selected edge annotations">
          <h3>Annotations</h3>
          <div className="selected-edge-annotation-list">
            {annotations.map((annotation) => (
              <article
                key={annotation.id}
                className={`selected-edge-annotation annotation-${annotation.kind} ${annotation.warning ? "is-warning" : ""}`}
                data-testid={`selected-edge-annotation-${annotation.id}`}
              >
                <span>{annotation.kind}</span>
                <strong>{annotation.title}</strong>
                {annotation.chips.length ? (
                  <div>
                    {annotation.chips.map((chip) => (
                      <b key={chip}>{chip}</b>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <dl>
        {[...fields, ...overlayFields].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "none"}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function NodeDetailPanel({
  node,
  incomingEdges,
  outgoingEdges,
  model,
  onClose
}: {
  node: GraphNode;
  incomingEdges: VisualEdge[];
  outgoingEdges: VisualEdge[];
  model: GraphModel;
  onClose: () => void;
}) {
  return (
    <aside className="selected-edge-panel selected-node-panel" aria-label="Selected node details">
      <div className="panel-heading">
        <div>
          <h2>Selected node</h2>
          <p>{node.label}</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <dl>
        <div>
          <dt>nodeId</dt>
          <dd>{node.id}</dd>
        </div>
        <div>
          <dt>type</dt>
          <dd>{node.type}</dd>
        </div>
        <div>
          <dt>region</dt>
          <dd>{node.region}</dd>
        </div>
        <div>
          <dt>zone</dt>
          <dd>{node.zone}</dd>
        </div>
      </dl>
      <div className="selected-node-connection-grid">
        <EdgePanel title={`Incoming (${incomingEdges.length})`} edges={incomingEdges} model={model} />
        <EdgePanel title={`Outgoing (${outgoingEdges.length})`} edges={outgoingEdges} model={model} />
      </div>
    </aside>
  );
}

function getSelectedNodeDetail(
  nodes: TopologyFlowNode[],
  edges: TopologyFlowEdge[],
  selectedNodeId?: string
): SelectedNodeDetail | undefined {
  if (!selectedNodeId) {
    return undefined;
  }
  const node = nodes.find((candidate) => candidate.id === selectedNodeId)?.data.node;
  if (!node) {
    return undefined;
  }
  return {
    node,
    incomingEdges: edges.flatMap((edge) => (edge.data?.edge.visibleTo === selectedNodeId ? [edge.data.edge] : [])),
    outgoingEdges: edges.flatMap((edge) => (edge.data?.edge.visibleFrom === selectedNodeId ? [edge.data.edge] : []))
  };
}

function FlowDiagram({
  title,
  subtitle,
  layout,
  model,
  overlayModel,
  groups = [],
  onToggle
}: {
  title: string;
  subtitle: string;
  layout: FlowLayoutModel;
  model: GraphModel;
  overlayModel: OverlayModel;
  groups?: GraphNode[];
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const { nodes, edges } = useMemo(
    () => buildFlowElements(layout, overlayModel, onToggle, selectedEdgeId, selectedNodeId),
    [layout, overlayModel, onToggle, selectedEdgeId, selectedNodeId]
  );
  const selectedFlowEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdge = selectedFlowEdge?.data?.edge;
  const selectedOverlay = selectedFlowEdge?.data?.resolvedOverlay;
  const selectedNodeDetail = getSelectedNodeDetail(nodes, edges, selectedNodeId);

  return (
    <section className="flow-panel" aria-label={title}>
      <div className="region-title">
        <Layers3 size={20} aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {groups.length > 0 ? (
        <div className="flow-group-controls" aria-label="Collapsible topology groups">
          {groups.map((group) => (
            <CollapseButton key={group.id} node={group} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
      <div className="flow-viewport">
        {selectedEdge ? (
          <EdgeDetailPanel edge={selectedEdge} overlay={selectedOverlay} model={model} onClose={() => setSelectedEdgeId(undefined)} />
        ) : null}
        {selectedNodeDetail ? (
          <NodeDetailPanel
            node={selectedNodeDetail.node}
            incomingEdges={selectedNodeDetail.incomingEdges}
            outgoingEdges={selectedNodeDetail.outgoingEdges}
            model={model}
            onClose={() => setSelectedNodeId(undefined)}
          />
        ) : null}
        <InteractiveFlowCanvas
          className="flow-canvas"
          testId="flow-diagram"
          nodes={nodes}
          edges={edges}
          onNodeClick={(nodeId) => {
            setSelectedEdgeId(undefined);
            setSelectedNodeId(nodeId);
          }}
          onEdgeClick={(edgeId) => {
            setSelectedNodeId(undefined);
            setSelectedEdgeId(edgeId);
          }}
          onPaneClick={() => {
            setSelectedEdgeId(undefined);
            setSelectedNodeId(undefined);
          }}
        >
          <div className="lane-labels" aria-hidden="true">
            {layout.lanes.map((lane) => (
              <span
                key={lane.id}
                className={`lane-label lane-${lane.id}`}
                style={{ top: CANVAS_MARGIN_Y + laneIndex(layout.lanes, lane.id) * LANE_HEIGHT + 8 }}
              >
                {lane.label}
              </span>
            ))}
          </div>
          {layout.stages.map((stage, stageIndex) => {
            const { left, top } = getStagePosition(stageIndex, stage.lane, layout.lanes);
            return (
              <section
                key={stage.id}
                className={`flow-stage-heading lane-${stage.lane}`}
                style={{ left, top, width: STAGE_WIDTH }}
                data-testid={`flow-stage-${stage.id}`}
              >
                <h3>{stage.label}</h3>
              </section>
            );
          })}
        </InteractiveFlowCanvas>
      </div>
      <details className="flow-details">
        <summary>Edge inventory for this view</summary>
        <EdgePanel title="Directional edges" edges={layout.edges} model={model} />
      </details>
    </section>
  );
}

function RegionalView({
  view,
  model,
  overlayModel,
  onToggle
}: {
  view: RegionViewManifest;
  model: GraphModel;
  overlayModel: OverlayModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const layout = getFlowLayout(model, view);

  return (
    <section className="topology-view" aria-label="Regional end-to-end topology">
      <FlowDiagram
        title={`${view.region} sequential architecture flow`}
        subtitle="Whiteboard-style stages grouped by application/system type"
        layout={layout}
        model={model}
        overlayModel={overlayModel}
        groups={model.visibleNodes.filter((node) => node.isGroup && node.region === view.region)}
        onToggle={onToggle}
      />
    </section>
  );
}

function CrossRegionView({ view, model, overlayModel }: { view: CrossRegionViewManifest; model: GraphModel; overlayModel: OverlayModel }) {
  const groups = getCrossRegionGroups(model, view);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const routeMap = useMemo(
    () => buildCrossRegionRouteMap(model, overlayModel, groups, selectedEdgeId, selectedNodeId),
    [model, overlayModel, groups, selectedEdgeId, selectedNodeId]
  );
  const selectedFlowEdge = routeMap.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdge = selectedFlowEdge?.data?.edge;
  const selectedOverlay = selectedFlowEdge?.data?.resolvedOverlay;
  const selectedNodeDetail = getSelectedNodeDetail(routeMap.nodes, routeMap.edges, selectedNodeId);

  return (
    <section className="cross-region-layout" aria-label="Cross-region edge detail">
      <section className="flow-panel cross-region-panel" aria-label="Cross-region route map">
        <div className="region-title">
          <GitBranch size={20} aria-hidden="true" />
          <div>
            <h2>Cross-region route map</h2>
            <p>USE1 source applications publishing to remote aggregate and partner streams</p>
          </div>
        </div>
        <div className="route-legend" aria-label="Cross-region route legend">
          <span><i className="legend-line primary" />Steady partner publish</span>
          <span><i className="legend-line cross" />Remote aggregate publish</span>
          <span><i className="legend-line secondary" />Remote replay</span>
        </div>
        <div className="flow-viewport">
          {selectedEdge ? (
            <EdgeDetailPanel edge={selectedEdge} overlay={selectedOverlay} model={model} onClose={() => setSelectedEdgeId(undefined)} />
          ) : null}
          {selectedNodeDetail ? (
            <NodeDetailPanel
              node={selectedNodeDetail.node}
              incomingEdges={selectedNodeDetail.incomingEdges}
              outgoingEdges={selectedNodeDetail.outgoingEdges}
              model={model}
              onClose={() => setSelectedNodeId(undefined)}
            />
          ) : null}
          <InteractiveFlowCanvas
            className="cross-region-canvas"
            testId="cross-region-map"
            nodes={routeMap.nodes}
            edges={routeMap.edges}
            onNodeClick={(nodeId) => {
              setSelectedEdgeId(undefined);
              setSelectedNodeId(nodeId);
            }}
            onEdgeClick={(edgeId) => {
              setSelectedNodeId(undefined);
              setSelectedEdgeId(edgeId);
            }}
            onPaneClick={() => {
              setSelectedEdgeId(undefined);
              setSelectedNodeId(undefined);
            }}
          >
            <div className="region-column-label source-region" style={{ left: 40 }}>Source use1</div>
            {routeMap.regions.map((region) => (
              <div key={region.id} className="region-column-label destination-region-label" style={{ left: region.left, top: region.top }}>
                Destination {region.id}
              </div>
            ))}
          </InteractiveFlowCanvas>
        </div>
        <details className="flow-details">
          <summary>Destination-region edge inventory</summary>
          <div className="cross-region-inventory">
            {groups.map((group) => (
              <EdgePanel key={group.destinationRegion} title={`Destination ${group.destinationRegion}`} edges={group.edges} model={model} />
            ))}
          </div>
        </details>
      </section>
    </section>
  );
}

function FocusView({
  view,
  model,
  overlayModel,
  onToggle
}: {
  view: FocusViewManifest;
  model: GraphModel;
  overlayModel: OverlayModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const focus = getFocusView(model, view);
  const focusStages = [
    ["focus_hot_router", "USE1 hot router", "hot", "use1.hot.router"],
    ["focus_slow_streams", "Source-region slow streams", "slow_lane", "use1.partner.slow_streams"],
    ["focus_slow_processor", "Source-region slow processor", "slow_lane", "use1.partner.slow_processor"],
    ["focus_partner_stream", "USW2 partner stream", "partner", "usw2.partner.stream.example"],
    ["focus_partner_indexer", "USW2 partner indexer/app", "partner", "usw2.partner.indexer.example"],
    ["focus_partner_clusters", "Multiple USW2 partner clusters", "partner", "usw2.partner.cluster."]
  ].map<FlowStageModel>(([id, label, lane, nodeId]) => ({
    id,
    label,
    lane,
    nodes: focus.nodes.filter((node) => node.id === nodeId || node.id.startsWith(nodeId))
  })).filter((stage) => stage.nodes.length > 0);

  return (
    <section className="topology-view focus-layout" aria-label="Representative partner path">
      <FlowDiagram
        title="Representative partner cross-region path"
        subtitle="Primary route branches to multiple clusters; secondary source-local slow lane stays visible"
        layout={{ view, lanes: DEFAULT_FLOW_LANES, stages: focusStages, edges: focus.edges }}
        model={model}
        overlayModel={overlayModel}
        onToggle={onToggle}
      />
    </section>
  );
}

function ViewBody({
  activeView,
  model,
  overlayModel,
  onToggle
}: {
  activeView: ArchitectureView;
  model: GraphModel;
  overlayModel: OverlayModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  if (activeView.mode === "region") {
    return <RegionalView view={activeView} model={model} overlayModel={overlayModel} onToggle={onToggle} />;
  }
  if (activeView.mode === "cross_region") {
    return <CrossRegionView view={activeView} model={model} overlayModel={overlayModel} />;
  }
  return <FocusView view={activeView} model={model} overlayModel={overlayModel} onToggle={onToggle} />;
}

function formatOverlayTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function Dashboard({ manifest, overlays = EMPTY_OVERLAYS, runtimeInfo, toolbarSlot }: DashboardProps) {
  const [activeViewId, setActiveViewId] = useState(manifest.views[0]?.id ?? "");
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});

  const modelResult = useMemo(() => {
    try {
      return {
        model: buildGraphModel(manifest, collapsedOverrides),
        overlayModel: buildOverlayModel(manifest, overlays),
        error: undefined
      };
    } catch (error) {
      return {
        model: undefined,
        overlayModel: undefined,
        error: error instanceof Error ? error.message : "Unknown graph build failure"
      };
    }
  }, [manifest, overlays, collapsedOverrides]);

  if (modelResult.error || !modelResult.model || !modelResult.overlayModel) {
    return <ErrorPanel title="Invalid architecture data" message={modelResult.error ?? "Graph model failed to build"} />;
  }

  const model = modelResult.model;
  const overlayModel = modelResult.overlayModel;
  const activeView = model.viewById.get(activeViewId) ?? manifest.views[0];

  const overlayState = runtimeInfo?.previewActive ? "preview" : runtimeInfo?.overlayStatus.state;
  const viewModeLabel: Record<ArchitectureView["mode"], string> = {
    region: "Regional flow",
    cross_region: "Cross-region map",
    focus: "Focus path"
  };

  return (
    <div className="app-shell">
      <aside className="command-rail" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Network size={18} />
          </span>
          <div>
            <span className="brand-eyebrow">Topology / v0.1</span>
            <strong className="brand-name">Mission Console</strong>
          </div>
        </div>

        <nav className="rail-section rail-views" aria-label="Architecture views">
          <header className="rail-section-header">
            <span className="rail-section-index">01</span>
            <h2>Views</h2>
            <span className="rail-section-count">{manifest.views.length.toString().padStart(2, "0")}</span>
          </header>
          <ul className="view-list" role="tablist">
            {manifest.views.map((view, index) => {
              const isActive = view.id === activeView.id;
              return (
                <li key={view.id}>
                  <button
                    type="button"
                    className={`view-tab ${isActive ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveViewId(view.id)}
                  >
                    <span className="view-tab-index">{(index + 1).toString().padStart(2, "0")}</span>
                    <span className="view-tab-body">
                      <span className="view-tab-label">{view.label}</span>
                      <span className="view-tab-mode">{viewModeLabel[view.mode]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="view-picker">
            <span>View</span>
            <select value={activeView.id} onChange={(event) => setActiveViewId(event.target.value)}>
              {manifest.views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.label}
                </option>
              ))}
            </select>
          </label>
        </nav>

        <section className="rail-section rail-legend" aria-label="Edge legend">
          <header className="rail-section-header">
            <span className="rail-section-index">02</span>
            <h2>Legend</h2>
          </header>
          <ul className="legend-list">
            <li><i className="legend-line primary" /><span>Primary path</span></li>
            <li><i className="legend-line cross" /><span>Cross-region</span></li>
            <li><i className="legend-line read" /><span>Read serve</span></li>
            <li><i className="legend-line secondary" /><span>Slow / replay</span></li>
            <li><i className="legend-line warning" /><span>Warning</span></li>
          </ul>
        </section>

        {runtimeInfo ? (
          <section className={`rail-section rail-status status-${overlayState}`} aria-label="Overlay runtime status">
            <header className="rail-section-header">
              <span className="rail-section-index">03</span>
              <h2>Status</h2>
            </header>
            <div className="status-readout">
              <span className="status-led" aria-hidden="true" />
              <div className="status-rows">
                <div className="status-row">
                  <span>State</span>
                  <b>{overlayState}</b>
                </div>
                <div className="status-row">
                  <span>Revision</span>
                  <b>r{runtimeInfo.overlayRevision}</b>
                </div>
                <div className="status-row">
                  <span>Source</span>
                  <b title={runtimeInfo.overlaySource}>{runtimeInfo.overlaySource}</b>
                </div>
                <div className="status-row">
                  <span>Updated</span>
                  <b>{formatOverlayTime(runtimeInfo.overlayGeneratedAt)}</b>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">Topology Manifest // {activeView.id}</span>
            <h1 data-testid="dashboard-title">Architecture Topology Explorer</h1>
            <p>Loaded from the runtime architecture API with validated overlay decorators.</p>
          </div>
          <div className="topbar-actions">{toolbarSlot}</div>
        </header>

        <ViewBody
          activeView={activeView}
          model={model}
          overlayModel={overlayModel}
          onToggle={(nodeId, collapsed) =>
            setCollapsedOverrides((current) => ({
              ...current,
              [nodeId]: collapsed
            }))
          }
        />
      </div>
    </div>
  );
}

export { ErrorPanel };
