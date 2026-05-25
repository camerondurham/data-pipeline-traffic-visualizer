import type { VisualEdge } from "./graphBuilder";
import type {
  ArchitectureManifest,
  ArchitectureOverlays,
  EdgeDecorator,
  NodeDecorator,
  OverlayMetric,
  RouteDecorator
} from "./zod";

export type OverlayTone = "default" | "primary" | "secondary" | "cross" | "read";

export interface ResolvedNodeOverlay {
  decorators: NodeDecorator[];
  chips: string[];
  tooltip?: string;
}

export interface ResolvedEdgeOverlay {
  edgeDecorators: EdgeDecorator[];
  routeDecorators: RouteDecorator[];
  badges: string[];
  metrics: OverlayMetric[];
  warning: boolean;
  tone?: OverlayTone;
  thickness?: number;
  metricLabel?: string;
  tooltip?: string;
}

export interface OverlayModel {
  overlays: ArchitectureOverlays;
  nodeDecoratorsByNodeId: Map<string, NodeDecorator[]>;
  edgeDecoratorsByEdgeId: Map<string, EdgeDecorator[]>;
  routeDecoratorsByEdgeId: Map<string, RouteDecorator[]>;
}

function assertUniqueDecoratorIds(overlays: ArchitectureOverlays): void {
  const seen = new Set<string>();
  const allDecorators = [
    ...overlays.node_decorators,
    ...overlays.edge_decorators,
    ...overlays.route_decorators
  ];

  for (const decorator of allDecorators) {
    if (seen.has(decorator.id)) {
      throw new Error(`Duplicate overlay decorator id: ${decorator.id}`);
    }
    seen.add(decorator.id);
  }
}

export function validateOverlayReferences(manifest: ArchitectureManifest, overlays: ArchitectureOverlays): void {
  assertUniqueDecoratorIds(overlays);

  const nodeIds = new Set(manifest.nodes.map((node) => node.id));
  const edgeById = new Map(manifest.edges.map((edge) => [edge.id, edge]));

  for (const decorator of overlays.node_decorators) {
    if (!nodeIds.has(decorator.node_id)) {
      throw new Error(`Node decorator ${decorator.id} references missing node: ${decorator.node_id}`);
    }
  }

  for (const decorator of overlays.edge_decorators) {
    if (!edgeById.has(decorator.edge_id)) {
      throw new Error(`Edge decorator ${decorator.id} references missing edge: ${decorator.edge_id}`);
    }
  }

  for (const decorator of overlays.route_decorators) {
    if (!nodeIds.has(decorator.source_node_id)) {
      throw new Error(`Route decorator ${decorator.id} references missing source node: ${decorator.source_node_id}`);
    }

    let expectedFrom = decorator.source_node_id;
    for (const edgeId of decorator.edge_ids) {
      const edge = edgeById.get(edgeId);
      if (!edge) {
        throw new Error(`Route decorator ${decorator.id} references missing edge: ${edgeId}`);
      }
      if (edge.from !== expectedFrom) {
        throw new Error(
          `Route decorator ${decorator.id} has non-contiguous route at ${edgeId}: expected source ${expectedFrom}, got ${edge.from}`
        );
      }
      expectedFrom = edge.to;
    }
  }
}

export function buildOverlayModel(manifest: ArchitectureManifest, overlays: ArchitectureOverlays): OverlayModel {
  validateOverlayReferences(manifest, overlays);

  const nodeDecoratorsByNodeId = new Map<string, NodeDecorator[]>();
  const edgeDecoratorsByEdgeId = new Map<string, EdgeDecorator[]>();
  const routeDecoratorsByEdgeId = new Map<string, RouteDecorator[]>();

  for (const decorator of overlays.node_decorators) {
    nodeDecoratorsByNodeId.set(decorator.node_id, [
      ...(nodeDecoratorsByNodeId.get(decorator.node_id) ?? []),
      decorator
    ]);
  }

  for (const decorator of overlays.edge_decorators) {
    edgeDecoratorsByEdgeId.set(decorator.edge_id, [
      ...(edgeDecoratorsByEdgeId.get(decorator.edge_id) ?? []),
      decorator
    ]);
  }

  for (const decorator of overlays.route_decorators) {
    for (const edgeId of decorator.edge_ids) {
      routeDecoratorsByEdgeId.set(edgeId, [
        ...(routeDecoratorsByEdgeId.get(edgeId) ?? []),
        decorator
      ]);
    }
  }

  return {
    overlays,
    nodeDecoratorsByNodeId,
    edgeDecoratorsByEdgeId,
    routeDecoratorsByEdgeId
  };
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

function decoratorTitle(decorator: { id: string; title?: string }): string {
  return decorator.title ?? decorator.id;
}

function tooltipForDecorators(decorators: Array<NodeDecorator | EdgeDecorator | RouteDecorator>): string | undefined {
  if (decorators.length === 0) {
    return undefined;
  }

  return decorators
    .map((decorator) => {
      const metrics = "metrics" in decorator ? decorator.metrics.map(formatMetricChip) : [];
      const badges = "badges" in decorator ? decorator.badges : [];
      return [decoratorTitle(decorator), ...metrics, ...badges].join("\n");
    })
    .join("\n\n");
}

export function resolveNodeOverlay(model: OverlayModel, nodeId: string): ResolvedNodeOverlay | undefined {
  const decorators = model.nodeDecoratorsByNodeId.get(nodeId) ?? [];
  if (decorators.length === 0) {
    return undefined;
  }

  return {
    decorators,
    chips: uniqueStrings(decorators.flatMap((decorator) => [
      ...decorator.metrics.map(formatMetricChip),
      ...decorator.badges
    ])),
    tooltip: tooltipForDecorators(decorators)
  };
}

export function resolveEdgeOverlay(model: OverlayModel, edge: VisualEdge): ResolvedEdgeOverlay | undefined {
  const edgeDecorators = uniqueDecorators(edge.sourceEdgeIds.flatMap((edgeId) => model.edgeDecoratorsByEdgeId.get(edgeId) ?? []));
  const routeDecorators = uniqueDecorators(edge.sourceEdgeIds.flatMap((edgeId) => model.routeDecoratorsByEdgeId.get(edgeId) ?? []));
  const decorators = [...edgeDecorators, ...routeDecorators];

  if (decorators.length === 0) {
    return undefined;
  }

  const badges = uniqueStrings(decorators.flatMap((decorator) => decorator.badges));
  const metrics = decorators.flatMap((decorator) => decorator.metrics);
  const explicitMetricLabel = decorators.find((decorator) => decorator.metric_label)?.metric_label;
  const tone = [...decorators].reverse().find((decorator) => decorator.tone)?.tone;
  const thickness = Math.max(...decorators.flatMap((decorator) => decorator.thickness ?? []), 0) || undefined;

  return {
    edgeDecorators,
    routeDecorators,
    badges: [...badges, ...metrics.map(formatMetricChip)],
    metrics,
    warning: decorators.some((decorator) => decorator.warning),
    tone,
    thickness,
    metricLabel: explicitMetricLabel,
    tooltip: tooltipForDecorators(decorators)
  };
}

function uniqueDecorators<T extends { id: string }>(decorators: T[]): T[] {
  const seen = new Set<string>();
  return decorators.filter((decorator) => {
    if (seen.has(decorator.id)) {
      return false;
    }
    seen.add(decorator.id);
    return true;
  });
}
