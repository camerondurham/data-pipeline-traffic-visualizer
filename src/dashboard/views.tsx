import { useMemo, useState } from "react";
import { GitBranch, Layers3 } from "lucide-react";
import {
  DEFAULT_FLOW_LANES,
  getCrossRegionGroups,
  getFlowLayout,
  getFocusView,
  type FlowLayoutModel,
  type FlowStageModel,
  type GraphModel
} from "../graphBuilder";
import type { OverlayModel } from "../overlays";
import type {
  ArchitectureView,
  CrossRegionView as CrossRegionViewManifest,
  FocusView as FocusViewManifest,
  RegionView as RegionViewManifest
} from "../zod";
import {
  EdgeDetailPanel,
  EdgePanel,
  InteractiveFlowCanvas,
  NodeDetailPanel,
  getSelectedNodeDetail
} from "./flowComponents";
import {
  CANVAS_MARGIN_Y,
  LANE_HEIGHT,
  STAGE_WIDTH,
  buildCrossRegionRouteMap,
  buildFlowElements,
  getStagePosition,
  laneIndex
} from "./flowModel";

function FlowDiagram({
  title,
  subtitle,
  layout,
  model,
  overlayModel,
  controlEditingEnabled,
  onControlUpdated
}: {
  title: string;
  subtitle: string;
  layout: FlowLayoutModel;
  model: GraphModel;
  overlayModel: OverlayModel;
  controlEditingEnabled: boolean;
  onControlUpdated?: () => void | Promise<void>;
}) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const selectEdge = (edgeId: string) => {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(edgeId);
  };
  const { nodes, edges } = useMemo(
    () => buildFlowElements(layout, overlayModel, selectedEdgeId, selectedNodeId, selectEdge),
    [layout, overlayModel, selectedEdgeId, selectedNodeId]
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
      <div className="flow-viewport">
        {selectedEdge ? (
          <EdgeDetailPanel
            edge={selectedEdge}
            overlay={selectedOverlay}
            model={model}
            controlEditingEnabled={controlEditingEnabled}
            onControlUpdated={onControlUpdated}
            onClose={() => setSelectedEdgeId(undefined)}
          />
        ) : null}
        {selectedNodeDetail ? (
          <NodeDetailPanel
            node={selectedNodeDetail.node}
            overlay={selectedNodeDetail.overlay}
            incomingEdges={selectedNodeDetail.incomingEdges}
            outgoingEdges={selectedNodeDetail.outgoingEdges}
            model={model}
            controlEditingEnabled={controlEditingEnabled}
            onControlUpdated={onControlUpdated}
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
            selectEdge(edgeId);
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
  controlEditingEnabled,
  onControlUpdated
}: {
  view: RegionViewManifest;
  model: GraphModel;
  overlayModel: OverlayModel;
  controlEditingEnabled: boolean;
  onControlUpdated?: () => void | Promise<void>;
}) {
  const layout = getFlowLayout(model, view);
  const regions = [
    view.region,
    ...Array.from(new Set(layout.stages.flatMap((stage) => stage.nodes.map((node) => node.region))))
      .filter((region) => region !== view.region)
  ];
  const spansRegions = regions.length > 1;

  return (
    <section className="topology-view" aria-label="Regional end-to-end topology">
      <FlowDiagram
        title={
          spansRegions
            ? `${regions.join(" + ")} end-to-end architecture flow`
            : `${view.region} sequential architecture flow`
        }
        subtitle={
          spansRegions
            ? "Source-region workflow with remote destination stream summary nodes"
            : "Whiteboard-style stages grouped by application/system type"
        }
        layout={layout}
        model={model}
        overlayModel={overlayModel}
        controlEditingEnabled={controlEditingEnabled}
        onControlUpdated={onControlUpdated}
      />
    </section>
  );
}

function CrossRegionView({
  view,
  model,
  overlayModel,
  controlEditingEnabled,
  onControlUpdated
}: {
  view: CrossRegionViewManifest;
  model: GraphModel;
  overlayModel: OverlayModel;
  controlEditingEnabled: boolean;
  onControlUpdated?: () => void | Promise<void>;
}) {
  const groups = useMemo(() => getCrossRegionGroups(model, view), [model, view]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const selectEdge = (edgeId: string) => {
    setSelectedNodeId(undefined);
    setSelectedEdgeId(edgeId);
  };
  const routeMap = useMemo(
    () => buildCrossRegionRouteMap(model, overlayModel, groups, selectedEdgeId, selectedNodeId, selectEdge),
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
            <EdgeDetailPanel
              edge={selectedEdge}
              overlay={selectedOverlay}
              model={model}
              controlEditingEnabled={controlEditingEnabled}
              onControlUpdated={onControlUpdated}
              onClose={() => setSelectedEdgeId(undefined)}
            />
          ) : null}
          {selectedNodeDetail ? (
            <NodeDetailPanel
              node={selectedNodeDetail.node}
              overlay={selectedNodeDetail.overlay}
              incomingEdges={selectedNodeDetail.incomingEdges}
              outgoingEdges={selectedNodeDetail.outgoingEdges}
              model={model}
              controlEditingEnabled={controlEditingEnabled}
              onControlUpdated={onControlUpdated}
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
              selectEdge(edgeId);
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

function focusStagesFor(focus: ReturnType<typeof getFocusView>): FlowStageModel[] {
  return [
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
}

function FocusView({
  view,
  model,
  overlayModel,
  controlEditingEnabled,
  onControlUpdated
}: {
  view: FocusViewManifest;
  model: GraphModel;
  overlayModel: OverlayModel;
  controlEditingEnabled: boolean;
  onControlUpdated?: () => void | Promise<void>;
}) {
  const focus = getFocusView(model, view);

  return (
    <section className="topology-view focus-layout" aria-label="Representative partner path">
      <FlowDiagram
        title="Representative partner cross-region path"
        subtitle="Primary route branches to multiple clusters; secondary source-local slow lane stays visible"
        layout={{ view, lanes: DEFAULT_FLOW_LANES, stages: focusStagesFor(focus), edges: focus.edges }}
        model={model}
        overlayModel={overlayModel}
        controlEditingEnabled={controlEditingEnabled}
        onControlUpdated={onControlUpdated}
      />
    </section>
  );
}

export function ViewBody({
  activeView,
  model,
  overlayModel,
  controlEditingEnabled,
  onControlUpdated
}: {
  activeView: ArchitectureView;
  model: GraphModel;
  overlayModel: OverlayModel;
  controlEditingEnabled: boolean;
  onControlUpdated?: () => void | Promise<void>;
}) {
  if (activeView.mode === "region") {
    return (
      <RegionalView
        view={activeView}
        model={model}
        overlayModel={overlayModel}
        controlEditingEnabled={controlEditingEnabled}
        onControlUpdated={onControlUpdated}
      />
    );
  }
  if (activeView.mode === "cross_region") {
    return (
      <CrossRegionView
        view={activeView}
        model={model}
        overlayModel={overlayModel}
        controlEditingEnabled={controlEditingEnabled}
        onControlUpdated={onControlUpdated}
      />
    );
  }
  return (
    <FocusView
      view={activeView}
      model={model}
      overlayModel={overlayModel}
      controlEditingEnabled={controlEditingEnabled}
      onControlUpdated={onControlUpdated}
    />
  );
}
