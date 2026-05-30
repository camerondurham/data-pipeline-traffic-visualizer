import { getBezierPath, MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import {
  getCrossRegionGroups,
  type FlowLayoutModel,
  type FlowStageModel,
  type GraphModel,
  type GraphNode,
  type VisualEdge
} from "../graphBuilder";
import {
  resolveEdgeOverlay,
  resolveNodeOverlay,
  type OverlayModel,
  type ResolvedEdgeOverlay,
  type ResolvedNodeOverlay
} from "../overlays";
import { formatMetricChip, uniqueStrings } from "../overlayFormatting";
import type { OverlayMetric } from "../zod";

export const STAGE_WIDTH = 166;
export const STAGE_GAP = 64;
export const LANE_HEIGHT = 240;
export const CANVAS_MARGIN_X = 172;
export const CANVAS_MARGIN_Y = 28;
export const STAGE_HEADER_HEIGHT = 38;
export const NODE_HEIGHT = 92;
export const NODE_GAP = 14;
export const SLOW_EDGE_TYPES = new Set(["sideline", "drain", "replay"]);
export const READ_EDGE_TYPES = new Set(["serve"]);
export const FLOW_MIN_ZOOM = 0.15;
export const FLOW_MAX_ZOOM = 2.25;
export const FLOW_FIT_VIEW_OPTIONS = { padding: 0.16 };

const CROSS_REGION_TARGET_Y = {
  aggregate: 96,
  partner: 226,
  regionGap: 200
};

export interface EdgeOverlayData {
  tone?: "default" | "primary" | "secondary" | "cross" | "read";
  thickness?: number;
  warning?: boolean;
  tooltip?: string;
}

export interface TopologyNodeData extends Record<string, unknown> {
  node: GraphNode;
  overlay?: ResolvedNodeOverlay;
  focusState?: "source" | "target" | "selected" | "incoming" | "outgoing" | "dimmed";
}

export interface TopologyEdgeData extends Record<string, unknown> {
  edge: VisualEdge;
  overlay?: EdgeOverlayData;
  resolvedOverlay?: ResolvedEdgeOverlay;
  focusState?: "selected" | "incoming" | "outgoing" | "dimmed";
  routeOffset?: number;
  onSelectEdge?: (edgeId: string) => void;
}

export type TopologyFlowNode = Node<TopologyNodeData, "topology">;
export type TopologyFlowEdge = Edge<TopologyEdgeData, "topology">;
type CrossRegionGroupModel = ReturnType<typeof getCrossRegionGroups>[number];

export type EdgeAnnotationKind = "edge" | "route";

export interface EdgeAnnotation {
  id: string;
  kind: EdgeAnnotationKind;
  title: string;
  chips: string[];
  warning?: boolean;
}

export interface FlowPoint {
  left: number;
  top: number;
}

export interface CrossRegionRouteMap {
  nodes: TopologyFlowNode[];
  edges: TopologyFlowEdge[];
  regions: { id: string; left: number; top: number }[];
}

export function nodeLabel(model: GraphModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
}

export function edgeTone(edge: VisualEdge, overlay?: EdgeOverlayData): string {
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

export function edgeKey(edge: VisualEdge): string {
  return edge.id;
}

export function flowEdgeId(edge: VisualEdge): string {
  return edge.id;
}

export function laneIndex(lanes: { id: string }[], lane: string): number {
  const index = lanes.findIndex((candidate) => candidate.id === lane);
  return index >= 0 ? index : lanes.length;
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

export function buildEdgeAnnotations(resolved?: ResolvedEdgeOverlay): EdgeAnnotation[] {
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

export function edgeOverlayLabelChips(resolved?: ResolvedEdgeOverlay): string[] {
  return uniqueStrings(buildEdgeAnnotations(resolved).flatMap((annotation) => annotation.chips)).slice(0, 3);
}

export function presentationOverlayFromResolved(resolved?: ResolvedEdgeOverlay): EdgeOverlayData | undefined {
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

export function mergeEdgeOverlays(fallback?: EdgeOverlayData, resolved?: EdgeOverlayData): EdgeOverlayData | undefined {
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

export function getStagePosition(stageIndex: number, lane: string, lanes: { id: string }[]): FlowPoint {
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

export function buildFlowElements(
  layout: FlowLayoutModel,
  overlayModel: OverlayModel,
  selectedEdgeId?: string,
  selectedNodeId?: string,
  onSelectEdge?: (edgeId: string) => void
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const nodePositions = buildNodePositions(layout.stages, layout.lanes);
  const visibleEdges = layout.edges.filter((edge) => nodePositions.has(edge.from) && nodePositions.has(edge.to));
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
        source: edge.from,
        target: edge.to,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          edge,
          overlay: presentationOverlayFromResolved(resolvedOverlay),
          resolvedOverlay,
          focusState,
          routeOffset: routeOffsets.get(id) ?? 0,
          onSelectEdge
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
    const endpoint = edge.type === "replay" ? edge.from : edge.to;
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
  focusState?: TopologyNodeData["focusState"],
  overlay?: ResolvedNodeOverlay
): TopologyFlowNode {
  return {
    id: node.id,
    type: "topology",
    position: { x: position.left, y: position.top },
    data: { node, overlay, focusState },
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
    if (nodeId === selectedEdge.from) {
      return "source";
    }
    if (nodeId === selectedEdge.to) {
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
  const hasIncoming = visibleEdges.some((edge) => edge.from === nodeId && edge.to === selectedNodeId);
  const hasOutgoing = visibleEdges.some((edge) => edge.from === selectedNodeId && edge.to === nodeId);
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
  if (edge.from === selectedNodeId) {
    return "outgoing";
  }
  if (edge.to === selectedNodeId) {
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

export function getEdgeRoute({
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
  const source = model.nodeById.get(edge.from);
  const target = model.nodeById.get(edge.to);

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
  const sourceIds = Array.from(new Set(groups.flatMap((group) => group.edges.map((edge) => edge.from))));
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

export function buildCrossRegionRouteMap(
  model: GraphModel,
  overlayModel: OverlayModel,
  groups: CrossRegionGroupModel[],
  selectedEdgeId?: string,
  selectedNodeId?: string,
  onSelectEdge?: (edgeId: string) => void
): CrossRegionRouteMap {
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
        nodeFocusState(node.id, selectedEdge, selectedNodeId, visibleEdges),
        resolveNodeOverlay(overlayModel, node.id)
      )
    );
  });

  groups.forEach((group, groupIndex) => {
    const left = destinationStartX + groupIndex * destinationGap;
    for (const edge of group.edges) {
      const target = model.nodeById.get(edge.to);
      if (target) {
        nodeById.set(
          target.id,
          makeFlowNode(
            target,
            { left, top: targetYFor(target, groupIndex) },
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
        source: edge.from,
        target: edge.to,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          edge,
          overlay: mergeEdgeOverlays(crossRegionOverlay(edge, model), presentationOverlayFromResolved(resolvedOverlay)),
          resolvedOverlay,
          focusState,
          routeOffset: routeOffsets.get(id) ?? 0,
          onSelectEdge
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

export function edgeFieldValue(edge: VisualEdge, field: "from" | "to" | "sourceRegion" | "destinationRegion"): string {
  return edge[field];
}
