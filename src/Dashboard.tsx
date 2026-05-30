import { useMemo, useState, type ReactNode } from "react";
import { Network } from "lucide-react";
import { buildGraphModel } from "./graphBuilder";
import { buildOverlayModel } from "./overlays";
import { ErrorPanel } from "./dashboard/flowComponents";
import { ViewBody } from "./dashboard/views";
import type { OverlayRuntimeStatus } from "./runtime/types";
import type { ArchitectureManifest, ArchitectureOverlays, ArchitectureView } from "./zod";
import { EMPTY_ARCHITECTURE_OVERLAYS as EMPTY_OVERLAYS } from "./zod";

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

const VIEW_MODE_LABEL: Record<ArchitectureView["mode"], string> = {
  region: "Regional flow",
  cross_region: "Cross-region map",
  focus: "Focus path"
};

function formatOverlayTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function Dashboard({ manifest, overlays = EMPTY_OVERLAYS, runtimeInfo, toolbarSlot }: DashboardProps) {
  const [activeViewId, setActiveViewId] = useState(manifest.views[0]?.id ?? "");

  const modelResult = useMemo(() => {
    try {
      return {
        model: buildGraphModel(manifest),
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
  }, [manifest, overlays]);

  if (modelResult.error || !modelResult.model || !modelResult.overlayModel) {
    return <ErrorPanel title="Invalid architecture data" message={modelResult.error ?? "Graph model failed to build"} />;
  }

  const model = modelResult.model;
  const overlayModel = modelResult.overlayModel;
  const activeView = model.viewById.get(activeViewId) ?? manifest.views[0];
  const overlayState = runtimeInfo?.previewActive ? "preview" : runtimeInfo?.overlayStatus.state;

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
                      <span className="view-tab-mode">{VIEW_MODE_LABEL[view.mode]}</span>
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

        <ViewBody activeView={activeView} model={model} overlayModel={overlayModel} />
      </div>
    </div>
  );
}

export { ErrorPanel };
