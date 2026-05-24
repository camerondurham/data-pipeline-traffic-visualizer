import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch, Layers3 } from "lucide-react";
import {
  buildGraphModel,
  getCrossRegionGroups,
  getFocusView,
  getRegionalView,
  REGIONAL_ZONE_ORDER,
  requireView,
  type GraphModel,
  type GraphNode,
  type VisualEdge
} from "./graphBuilder";
import type { ArchitectureManifest, ArchitectureView } from "./zod";

interface DashboardProps {
  manifest: ArchitectureManifest;
}

function nodeLabel(model: GraphModel, id: string): string {
  return model.nodeById.get(id)?.label ?? id;
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

function RegionalView({
  model,
  onToggle
}: {
  model: GraphModel;
  onToggle: (nodeId: string, collapsed: boolean) => void;
}) {
  const view = requireView(model, "regional_end_to_end", "region");
  const regional = getRegionalView(model, view);

  return (
    <section className="topology-view" aria-label="Regional end-to-end topology">
      <div className="region-shell">
        <div className="region-title">
          <Layers3 size={20} aria-hidden="true" />
          <div>
            <h2>{regional.region}</h2>
            <p>{view.label}</p>
          </div>
        </div>
        <div className="zone-grid">
          {regional.zones.map((zone) => (
            <section key={zone.zone} className="zone-lane">
              <h3>{zone.zone.replace("_", " ")}</h3>
              <div className="node-stack">
                {zone.nodes.map((node) => (
                  <NodeCard key={node.id} node={node} onToggle={onToggle} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <EdgePanel title="Directional edges in region" edges={regional.edges} model={model} />
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
  const regions = [...new Set(focus.nodes.map((node) => node.region))].sort();

  return (
    <section className="topology-view focus-layout" aria-label="Representative partner path">
      <div className="focus-graph">
        {regions.map((region) => (
          <section key={region} className="region-shell">
            <div className="region-title">
              <Layers3 size={20} aria-hidden="true" />
              <div>
                <h2>{region}</h2>
                <p>{view.label}</p>
              </div>
            </div>
            <div className="zone-grid focus-zones">
              {REGIONAL_ZONE_ORDER.map((zone) => {
                const nodes = focus.nodes.filter((node) => node.region === region && node.zone === zone);
                if (nodes.length === 0) {
                  return null;
                }
                return (
                  <section key={zone} className="zone-lane">
                    <h3>{zone.replace("_", " ")}</h3>
                    <div className="node-stack">
                      {nodes.map((node) => (
                        <NodeCard key={node.id} node={node} onToggle={onToggle} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <EdgePanel title="Focus edges" edges={focus.edges} model={model} />
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
