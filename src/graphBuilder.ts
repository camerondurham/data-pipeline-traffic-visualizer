import type {
  ArchitectureEdge,
  ArchitectureManifest,
  ArchitectureNode,
  ArchitectureView,
  CrossRegionView,
  FlowLane,
  FocusView,
  RegionView
} from "./zod";

const REGIONAL_ZONE_ORDER = ["pre_aggregate", "aggregate", "hot", "cold", "partner"] as const;
export const DEFAULT_FLOW_LANES: FlowLane[] = [
  { id: "cold", label: "Cold branch" },
  { id: "normal", label: "Pre-aggregate and aggregate" },
  { id: "hot", label: "Hot branch" },
  { id: "slow_lane", label: "Slow-lane replay" },
  { id: "partner", label: "Partner routes" }
];

export type EdgeEmphasis = "default" | "primary" | "secondary";

export interface GraphNode extends ArchitectureNode {
  children: string[];
  isGroup: boolean;
}

export interface DerivedEdge {
  id: string;
  from: string;
  to: string;
  sourceRegion: string;
  destinationRegion: string;
  crossRegion: boolean;
  type: string;
  label?: string;
}

export interface VisualEdge extends DerivedEdge {
  emphasis: EdgeEmphasis;
}

export interface GraphModel {
  manifest: ArchitectureManifest;
  nodes: GraphNode[];
  visibleNodes: GraphNode[];
  edges: DerivedEdge[];
  visualEdges: VisualEdge[];
  nodeById: Map<string, GraphNode>;
  edgeById: Map<string, ArchitectureEdge>;
  viewById: Map<string, ArchitectureView>;
}

export interface FlowStageModel {
  id: string;
  label: string;
  lane: string;
  nodes: GraphNode[];
}

export interface FlowLayoutModel {
  view: RegionView | FocusView;
  lanes: FlowLane[];
  stages: FlowStageModel[];
  edges: VisualEdge[];
}

export interface CrossRegionGroup {
  destinationRegion: string;
  edges: VisualEdge[];
}

export interface FocusViewModel {
  view: FocusView;
  nodes: GraphNode[];
  edges: VisualEdge[];
}

export function assertUniqueIds(items: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

function assertSubset(subset: string[], superset: Set<string>, label: string, viewId: string): void {
  for (const id of subset) {
    if (!superset.has(id)) {
      throw new Error(`${viewId}.${label} references an edge outside focus_edges: ${id}`);
    }
  }
}

function assertAcyclicParents(nodesById: Map<string, ArchitectureNode>): void {
  for (const node of nodesById.values()) {
    const seen = new Set([node.id]);
    let parentId = node.parent;

    while (parentId) {
      if (seen.has(parentId)) {
        throw new Error(`Parent cycle detected at node ${node.id}: ${[...seen, parentId].join(" -> ")}`);
      }
      seen.add(parentId);
      parentId = nodesById.get(parentId)?.parent;
    }
  }
}

export function validateGraphReferences(manifest: ArchitectureManifest): void {
  assertUniqueIds(manifest.nodes, "node");
  assertUniqueIds(manifest.edges, "edge");
  assertUniqueIds(manifest.views, "view");

  const nodesById = new Map(manifest.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const edgeIds = new Set(manifest.edges.map((edge) => edge.id));

  for (const node of manifest.nodes) {
    if (node.parent && !nodeIds.has(node.parent)) {
      throw new Error(`Node ${node.id} references missing parent: ${node.parent}`);
    }
  }
  assertAcyclicParents(nodesById);

  for (const edge of manifest.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Edge ${edge.id} references missing source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references missing target node: ${edge.to}`);
    }
  }

  for (const view of manifest.views) {
    if (view.mode === "region") {
      const laneIds = new Set((view.lanes ?? DEFAULT_FLOW_LANES).map((lane) => lane.id));
      assertUniqueIds(view.stages ?? [], `${view.id} stage`);
      assertUniqueIds(view.lanes ?? [], `${view.id} lane`);

      for (const stage of view.stages ?? []) {
        if (!laneIds.has(stage.lane)) {
          throw new Error(`View ${view.id} stage ${stage.id} references missing lane: ${stage.lane}`);
        }
        for (const nodeId of stage.node_ids) {
          if (!nodeIds.has(nodeId)) {
            throw new Error(`View ${view.id} stage ${stage.id} references missing node: ${nodeId}`);
          }
        }
      }
    }

    if (view.mode !== "focus") {
      continue;
    }

    for (const edgeId of view.focus_edges) {
      if (!edgeIds.has(edgeId)) {
        throw new Error(`View ${view.id} references missing focus edge: ${edgeId}`);
      }
    }

    const focusEdges = new Set(view.focus_edges);
    assertSubset(view.primary_edges, focusEdges, "primary_edges", view.id);
    assertSubset(view.secondary_edges, focusEdges, "secondary_edges", view.id);
  }
}

function makeGraphNodes(manifest: ArchitectureManifest): { nodes: GraphNode[]; nodeById: Map<string, GraphNode> } {
  const childrenByParent = new Map<string, string[]>();
  for (const node of manifest.nodes) {
    if (!node.parent) {
      continue;
    }
    const children = childrenByParent.get(node.parent) ?? [];
    children.push(node.id);
    childrenByParent.set(node.parent, children);
  }

  const nodes = manifest.nodes.map<GraphNode>((node) => ({
    ...node,
    children: childrenByParent.get(node.id) ?? [],
    isGroup: (childrenByParent.get(node.id) ?? []).length > 0
  }));

  return { nodes, nodeById: new Map(nodes.map((node) => [node.id, node])) };
}

function uniqueNodesById(nodeIds: string[], nodeById: Map<string, GraphNode>): GraphNode[] {
  const seenIds = new Set<string>();
  const nodes: GraphNode[] = [];

  for (const nodeId of nodeIds) {
    if (seenIds.has(nodeId)) {
      continue;
    }
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    seenIds.add(nodeId);
    nodes.push(node);
  }

  return nodes;
}

function deriveEdge(edge: ArchitectureEdge, nodeById: Map<string, GraphNode>): DerivedEdge {
  const source = nodeById.get(edge.from);
  const target = nodeById.get(edge.to);
  if (!source || !target) {
    throw new Error(`Edge ${edge.id} references missing endpoint`);
  }

  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    sourceRegion: source.region,
    destinationRegion: target.region,
    crossRegion: source.region !== target.region,
    type: edge.type,
    label: edge.label
  };
}

function visualEdgesFor(
  edges: ArchitectureEdge[],
  nodeById: Map<string, GraphNode>,
  emphasisByEdgeId: Map<string, EdgeEmphasis> = new Map()
): VisualEdge[] {
  return edges.map((edge) => ({
    ...deriveEdge(edge, nodeById),
    emphasis: emphasisByEdgeId.get(edge.id) ?? "default"
  }));
}

export function buildGraphModel(manifest: ArchitectureManifest): GraphModel {
  validateGraphReferences(manifest);

  const { nodes, nodeById } = makeGraphNodes(manifest);
  const edgeById = new Map(manifest.edges.map((edge) => [edge.id, edge]));
  const viewById = new Map(manifest.views.map((view) => [view.id, view]));
  const edges = manifest.edges.map((edge) => deriveEdge(edge, nodeById));
  const visualEdges = visualEdgesFor(manifest.edges, nodeById);

  return {
    manifest,
    nodes,
    visibleNodes: nodes,
    edges,
    visualEdges,
    nodeById,
    edgeById,
    viewById
  };
}

export function getFlowLayout(model: GraphModel, view: RegionView): FlowLayoutModel {
  if (!view.stages || view.stages.length === 0) {
    const stages = REGIONAL_ZONE_ORDER.map<FlowStageModel>((zone) => ({
      id: zone,
      label: zone.replace("_", " "),
      lane: zone === "pre_aggregate" || zone === "aggregate" ? "normal" : zone,
      nodes: model.visibleNodes
        .filter((node) => node.region === view.region && node.zone === zone)
        .sort((left, right) => left.id.localeCompare(right.id))
    }));
    const nodeIds = new Set(stages.flatMap((stage) => stage.nodes.map((node) => node.id)));
    return {
      view,
      lanes: DEFAULT_FLOW_LANES,
      stages,
      edges: model.visualEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    };
  }

  const stages = view.stages.map<FlowStageModel>((stage) => ({
    id: stage.id,
    label: stage.label,
    lane: stage.lane,
    nodes: uniqueNodesById(stage.node_ids, model.nodeById)
  }));
  const nodeIds = new Set(stages.flatMap((stage) => stage.nodes.map((node) => node.id)));

  return {
    view,
    lanes: view.lanes ?? DEFAULT_FLOW_LANES,
    stages,
    edges: model.visualEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  };
}

export function getCrossRegionGroups(model: GraphModel, _view: CrossRegionView): CrossRegionGroup[] {
  const groups = new Map<string, VisualEdge[]>();
  for (const edge of model.visualEdges) {
    if (!edge.crossRegion) {
      continue;
    }
    const group = groups.get(edge.destinationRegion) ?? [];
    group.push(edge);
    groups.set(edge.destinationRegion, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([destinationRegion, edges]) => ({
      destinationRegion,
      edges: edges.sort((left, right) => left.id.localeCompare(right.id))
    }));
}

export function getFocusView(model: GraphModel, view: FocusView): FocusViewModel {
  const focusEdges = view.focus_edges.map((edgeId) => {
    const edge = model.edgeById.get(edgeId);
    if (!edge) {
      throw new Error(`View ${view.id} references missing focus edge: ${edgeId}`);
    }
    return edge;
  });

  const emphasisByEdgeId = new Map<string, EdgeEmphasis>();
  for (const id of view.primary_edges) {
    emphasisByEdgeId.set(id, "primary");
  }
  for (const id of view.secondary_edges) {
    emphasisByEdgeId.set(id, "secondary");
  }

  const edges = visualEdgesFor(focusEdges, model.nodeById, emphasisByEdgeId);
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  return {
    view,
    nodes: model.visibleNodes.filter((node) => nodeIds.has(node.id)),
    edges
  };
}

export function requireView<T extends ArchitectureView["mode"]>(
  model: GraphModel,
  viewId: string,
  mode: T
): Extract<ArchitectureView, { mode: T }> {
  const view = model.viewById.get(viewId);
  if (!view) {
    throw new Error(`Missing view: ${viewId}`);
  }
  if (view.mode !== mode) {
    throw new Error(`View ${viewId} must use mode ${mode}`);
  }
  return view as Extract<ArchitectureView, { mode: T }>;
}
