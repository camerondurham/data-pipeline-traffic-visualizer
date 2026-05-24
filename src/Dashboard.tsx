import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch, Layers3 } from "lucide-react";
import {
  buildGraphModel,
  getCrossRegionGroups,
  getFlowLayout,
  getFocusView,
  requireView,
  type FlowLayoutModel,
  type FlowStageModel,
  type GraphModel,
  type GraphNode,
  type VisualEdge
} from "./graphBuilder";
import type { ArchitectureManifest, ArchitectureView } from "./zod";

interface DashboardProps {
  manifest: ArchitectureManifest;
}

const STAGE_WIDTH = 166;
const STAGE_GAP = 54;
const LANE_HEIGHT = 190;
const CANVAS_MARGIN_X = 36;
const CANVAS_MARGIN_Y = 28;
const STAGE_HEADER_HEIGHT = 34;
const NODE_HEIGHT = 76;
const NODE_GAP = 10;

const LANE_ORDER = ["cold", "normal", "hot", "slow_lane", "partner"] as const;

function laneIndex(lane: string): number {
  const index = LANE_ORDER.indexOf(lane as (typeof LANE_ORDER)[number]);
  return index >= 0 ? index : LANE_ORDER.length;
}

function nodeLabel(model: GraphModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
}

function edgeTone(edge: VisualEdge): string {
  if (edge.emphasis === "primary") {
    return "primary";
  }
  if (edge.emphasis === "secondary" || ["sideline", "drain", "replay"].includes(edge.type)) {
    return "secondary";
  }
  if (edge.crossRegion) {
    return "cross";
  }
  return "default";
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

function NodeCard({
  node,
  onToggle
}: {
  node: GraphNode;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  return (
    <article className={`node-card type-${node.type}`}>
      <div>
        <strong>{node.label}</strong>
        <span>{node.id}</span>
      </div>
      <small>{node.type}</small>
      {node.isGroup ? (
        <button
          type="button"
          className="collapse-button"
          onClick={() => onToggle(node.id, !node.isCollapsed)}
          aria-label={`${node.isCollapsed ? "Expand" : "Collapse"} ${node.label}`}
        >
          {node.isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          {node.isCollapsed ? "Expand" : "Collapse"}
        </button>
      ) : null}
    </article>
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
        <span>{edge.sourceRegion} to {edge.destinationRegion}</span>
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
          <EdgeRow key={`${edge.visibleFrom}-${edge.visibleTo}-${edge.type}-${edge.emphasis}-${edge.sourceEdgeIds.join(".")}`} edge={edge} model={model} />
        ))}
      </div>
    </section>
  );
}

interface FlowPoint {
  x: number;
  y: number;
  lane: string;
}

function getStagePosition(stageIndex: number, lane: string): { left: number; top: number } {
  return {
    left: CANVAS_MARGIN_X + stageIndex * (STAGE_WIDTH + STAGE_GAP),
    top: CANVAS_MARGIN_Y + laneIndex(lane) * LANE_HEIGHT
  };
}

function buildNodePositions(stages: FlowStageModel[]): Map<string, FlowPoint> {
  const positions = new Map<string, FlowPoint>();

  stages.forEach((stage, stageIndex) => {
    const { left, top } = getStagePosition(stageIndex, stage.lane);
    stage.nodes.forEach((node, nodeIndex) => {
      positions.set(node.id, {
        x: left + STAGE_WIDTH / 2,
        y: top + STAGE_HEADER_HEIGHT + NODE_HEIGHT / 2 + nodeIndex * (NODE_HEIGHT + NODE_GAP),
        lane: stage.lane
      });
    });
  });

  return positions;
}

function edgePath(from: FlowPoint, to: FlowPoint, edge: VisualEdge): string {
  const startX = from.x + STAGE_WIDTH / 2 - 12;
  const endX = to.x - STAGE_WIDTH / 2 + 12;
  const startY = from.y;
  const endY = to.y;
  const dx = Math.max(Math.abs(endX - startX), 80);
  const curve = edge.type === "replay" || endX < startX ? dx * 0.35 : dx * 0.5;
  const slowOffset = ["sideline", "drain", "replay"].includes(edge.type) ? 34 : 0;

  return `M ${startX} ${startY} C ${startX + curve} ${startY + slowOffset}, ${endX - curve} ${endY + slowOffset}, ${endX} ${endY}`;
}

function FlowDiagram({
  title,
  subtitle,
  layout,
  model,
  groups = [],
  onToggle
}: {
  title: string;
  subtitle: string;
  layout: FlowLayoutModel;
  model: GraphModel;
  groups?: GraphNode[];
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const width = CANVAS_MARGIN_X * 2 + layout.stages.length * STAGE_WIDTH + Math.max(layout.stages.length - 1, 0) * STAGE_GAP;
  const height = CANVAS_MARGIN_Y * 2 + LANE_ORDER.length * LANE_HEIGHT;
  const nodePositions = buildNodePositions(layout.stages);
  const drawableEdges = layout.edges.filter((edge) => nodePositions.has(edge.visibleFrom) && nodePositions.has(edge.visibleTo));

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
            <button
              key={group.id}
              type="button"
              className="collapse-button"
              onClick={() => onToggle(group.id, !group.isCollapsed)}
              aria-label={`${group.isCollapsed ? "Expand" : "Collapse"} ${group.label}`}
            >
              {group.isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flow-scroll">
        <div className="flow-canvas" style={{ width, height }} data-testid="flow-diagram">
          <div className="lane-labels" aria-hidden="true">
            {layout.lanes.map((lane) => (
              <span
                key={lane.id}
                className={`lane-label lane-${lane.id}`}
                style={{ top: CANVAS_MARGIN_Y + laneIndex(lane.id) * LANE_HEIGHT + 8 }}
              >
                {lane.label}
              </span>
            ))}
          </div>
          <svg className="flow-edges" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="arrow-default" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 9 4.5 L 0 9 z" />
              </marker>
            </defs>
            {drawableEdges.map((edge) => {
              const from = nodePositions.get(edge.visibleFrom);
              const to = nodePositions.get(edge.visibleTo);
              if (!from || !to) {
                return null;
              }
              return (
                <path
                  key={`${edge.visibleFrom}-${edge.visibleTo}-${edge.type}-${edge.emphasis}-${edge.sourceEdgeIds.join(".")}`}
                  className={`flow-edge tone-${edgeTone(edge)}`}
                  d={edgePath(from, to, edge)}
                  markerEnd="url(#arrow-default)"
                />
              );
            })}
          </svg>
          {layout.stages.map((stage, stageIndex) => {
            const { left, top } = getStagePosition(stageIndex, stage.lane);
            return (
              <section
                key={stage.id}
                className={`flow-stage lane-${stage.lane}`}
                style={{ left, top, width: STAGE_WIDTH }}
                data-testid={`flow-stage-${stage.id}`}
              >
                <h3>{stage.label}</h3>
                <div className="flow-node-stack">
                  {stage.nodes.map((node) => (
                    <NodeCard key={node.id} node={node} onToggle={onToggle} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <details className="flow-details">
        <summary>Edge inventory for this view</summary>
        <EdgePanel title="Directional edges" edges={layout.edges} model={model} />
      </details>
    </section>
  );
}

function RegionalView({
  model,
  onToggle
}: {
  model: GraphModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const view = requireView(model, "regional_end_to_end", "region");
  const layout = getFlowLayout(model, view);

  return (
    <section className="topology-view" aria-label="Regional end-to-end topology">
      <FlowDiagram
        title={`${view.region} sequential architecture flow`}
        subtitle="Whiteboard-style stages grouped by application/system type"
        layout={layout}
        model={model}
        groups={model.visibleNodes.filter((node) => node.isGroup && node.region === view.region)}
        onToggle={onToggle}
      />
    </section>
  );
}

function CrossRegionView({ model }: { model: GraphModel }) {
  const view = requireView(model, "cross_region_detail", "cross_region");
  const groups = getCrossRegionGroups(model, view);

  return (
    <section className="cross-region-layout" aria-label="Cross-region edge detail">
      {groups.map((group) => (
        <section key={group.destinationRegion} className="destination-region">
          <div className="region-title">
            <GitBranch size={20} aria-hidden="true" />
            <div>
              <h2>Destination {group.destinationRegion}</h2>
              <p>Derived cross-region edges grouped by destination region</p>
            </div>
          </div>
          <div className="edge-list">
            {group.edges.map((edge) => (
              <EdgeRow key={`${edge.visibleFrom}-${edge.visibleTo}-${edge.type}-${edge.sourceEdgeIds.join(".")}`} edge={edge} model={model} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function FocusView({
  model,
  onToggle
}: {
  model: GraphModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const view = requireView(model, "representative_partner_path", "focus");
  const focus = getFocusView(model, view);
  const focusStages: FlowStageModel[] = [
    {
      id: "focus_hot_router",
      label: "USE1 hot router",
      lane: "hot",
      nodes: focus.nodes.filter((node) => node.id === "use1.hot.router")
    },
    {
      id: "focus_slow_streams",
      label: "Source-region slow streams",
      lane: "slow_lane",
      nodes: focus.nodes.filter((node) => node.id === "use1.partner.slow_streams")
    },
    {
      id: "focus_slow_processor",
      label: "Source-region slow processor",
      lane: "slow_lane",
      nodes: focus.nodes.filter((node) => node.id === "use1.partner.slow_processor")
    },
    {
      id: "focus_partner_stream",
      label: "USW2 partner stream",
      lane: "partner",
      nodes: focus.nodes.filter((node) => node.id === "usw2.partner.stream.example")
    },
    {
      id: "focus_partner_indexer",
      label: "USW2 partner indexer/app",
      lane: "partner",
      nodes: focus.nodes.filter((node) => node.id === "usw2.partner.indexer.example")
    },
    {
      id: "focus_partner_clusters",
      label: "Multiple USW2 partner clusters",
      lane: "partner",
      nodes: focus.nodes.filter((node) => node.id.startsWith("usw2.partner.cluster."))
    }
  ].filter((stage) => stage.nodes.length > 0);

  return (
    <section className="topology-view focus-layout" aria-label="Representative partner path">
      <FlowDiagram
        title="Representative partner cross-region path"
        subtitle="Primary route branches to multiple clusters; secondary source-local slow lane stays visible"
        layout={{ view, lanes: [
          { id: "cold", label: "Cold branch" },
          { id: "normal", label: "Aggregate" },
          { id: "hot", label: "Hot branch" },
          { id: "slow_lane", label: "Source-region fallback" },
          { id: "partner", label: "Destination partner route" }
        ], stages: focusStages, edges: focus.edges }}
        model={model}
        onToggle={onToggle}
      />
    </section>
  );
}

function ViewBody({
  activeView,
  model,
  onToggle
}: {
  activeView: ArchitectureView;
  model: GraphModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  if (activeView.mode === "region") {
    return <RegionalView model={model} onToggle={onToggle} />;
  }
  if (activeView.mode === "cross_region") {
    return <CrossRegionView model={model} />;
  }
  return <FocusView model={model} onToggle={onToggle} />;
}

export function Dashboard({ manifest }: DashboardProps) {
  const [activeViewId, setActiveViewId] = useState(manifest.views[0]?.id ?? "");
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});

  const modelResult = useMemo(() => {
    try {
      return { model: buildGraphModel(manifest, collapsedOverrides), error: undefined };
    } catch (error) {
      return { model: undefined, error: error instanceof Error ? error.message : "Unknown graph build failure" };
    }
  }, [manifest, collapsedOverrides]);

  if (modelResult.error || !modelResult.model) {
    return <ErrorPanel title="Invalid architecture manifest" message={modelResult.error ?? "Graph model failed to build"} />;
  }

  const model = modelResult.model;
  const activeView = model.viewById.get(activeViewId) ?? manifest.views[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Topology Manifest</span>
          <h1 data-testid="dashboard-title">Architecture Topology Explorer</h1>
          <p>Loaded from public/architecture.yaml. Cross-region state is derived from original endpoints.</p>
        </div>
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
      </header>

      <ViewBody
        activeView={activeView}
        model={model}
        onToggle={(nodeId, collapsed) =>
          setCollapsedOverrides((current) => ({
            ...current,
            [nodeId]: collapsed
          }))
        }
      />
    </div>
  );
}

export { ErrorPanel };
