import type { ReactNode } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  type EdgeProps,
  type NodeProps
} from "@xyflow/react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { GraphModel, GraphNode, VisualEdge } from "../graphBuilder";
import type { ResolvedEdgeOverlay, ResolvedNodeOverlay } from "../overlays";
import { formatMetricChip } from "../overlayFormatting";
import {
  FLOW_FIT_VIEW_OPTIONS,
  FLOW_MAX_ZOOM,
  FLOW_MIN_ZOOM,
  buildEdgeAnnotations,
  edgeKey,
  edgeOverlayLabelChips,
  edgeTone,
  edgeFieldValue,
  getEdgeRoute,
  nodeLabel,
  type TopologyFlowEdge,
  type TopologyFlowNode,
  type TopologyNodeData
} from "./flowModel";

const NODE_TYPES = { topology: TopologyNode };
const EDGE_TYPES = { topology: TopologyEdge };

export function ErrorPanel({ title, message }: { title: string; message: string }) {
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

function NodeCard({
  node,
  overlay,
  focusState
}: {
  node: GraphNode;
  overlay?: ResolvedNodeOverlay;
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
    </article>
  );
}

function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  return (
    <>
      <Handle className="flow-handle" type="target" position={Position.Left} />
      <NodeCard node={data.node} overlay={data.overlay} focusState={data.focusState} />
      <Handle className="flow-handle" type="source" position={Position.Right} />
    </>
  );
}

function edgeTooltip(edge: VisualEdge): string {
  return [
    edge.label ?? edge.type,
    `${edgeFieldValue(edge, "from")} -> ${edgeFieldValue(edge, "to")}`,
    `${edgeFieldValue(edge, "sourceRegion")} -> ${edgeFieldValue(edge, "destinationRegion")}`,
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
  const sourceLabel = nodeLabel(model, edge.from);
  const targetLabel = nodeLabel(model, edge.to);

  return (
    <article className={`edge-row ${edge.crossRegion ? "cross-region" : ""} emphasis-${edge.emphasis}`}>
      <div className="edge-route">
        <strong>{sourceLabel}</strong>
        <ChevronRight size={16} aria-hidden="true" />
        <strong>{targetLabel}</strong>
      </div>
      <div className="edge-meta">
        <span>{edge.label ?? edge.type}</span>
        <span>{edge.sourceRegion} to {edge.destinationRegion}</span>
        <span>{edge.id}</span>
      </div>
    </article>
  );
}

export function EdgePanel({ title, edges, model }: { title: string; edges: VisualEdge[]; model: GraphModel }) {
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

export function InteractiveFlowCanvas({
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

export function NodeDetailPanel({
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

export function getSelectedNodeDetail(
  nodes: TopologyFlowNode[],
  edges: TopologyFlowEdge[],
  selectedNodeId?: string
): { node: GraphNode; incomingEdges: VisualEdge[]; outgoingEdges: VisualEdge[] } | undefined {
  if (!selectedNodeId) {
    return undefined;
  }
  const node = nodes.find((candidate) => candidate.id === selectedNodeId)?.data.node;
  if (!node) {
    return undefined;
  }
  return {
    node,
    incomingEdges: edges.flatMap((edge) => (edge.data?.edge.to === selectedNodeId ? [edge.data.edge] : [])),
    outgoingEdges: edges.flatMap((edge) => (edge.data?.edge.from === selectedNodeId ? [edge.data.edge] : []))
  };
}

export function EdgeDetailPanel({
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
    ["from", edge.from],
    ["to", edge.to],
    ["type", edge.type],
    ["label", edge.label ?? ""],
    ["sourceRegion", edge.sourceRegion],
    ["destinationRegion", edge.destinationRegion],
    ["cross_region", String(edge.crossRegion)],
    ["edgeId", edge.id]
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
          <p>{nodeLabel(model, edge.from)} to {nodeLabel(model, edge.to)}</p>
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
