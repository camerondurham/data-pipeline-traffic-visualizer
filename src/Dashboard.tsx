import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Menu, PanelLeftClose } from "lucide-react";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TAGLINE } from "./branding";
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
    graphControlsVisible: boolean;
    graphControlApplyEnabled: boolean;
    previewActive?: boolean;
  };
  controlControlsVisible?: boolean;
  controlApplyEnabled?: boolean;
  onControlUpdated?: () => void | Promise<void>;
  toolbarSlot?: ReactNode;
}

const VIEW_MODE_LABEL: Record<ArchitectureView["mode"], string> = {
  region: "Regional flow",
  cross_region: "Cross-region map",
  focus: "Focus path"
};

const EDGE_LEGEND = [
  { label: "Primary path", tone: "success", chip: "Primary" },
  { label: "Cross-region", tone: "info", chip: "Cross" },
  { label: "Read serve", tone: "neutral", chip: "Read" },
  { label: "Slow / replay", tone: "warning", chip: "Replay" },
  { label: "Warning", tone: "error", chip: "Warn" }
] as const;

type BadgeTone = "success" | "info" | "neutral" | "warning" | "error";
type ResolvedVisualMode = "dark" | "light";
type VisualMode = "system" | ResolvedVisualMode;

function readSystemVisualMode(): ResolvedVisualMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function formatOverlayTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function statusTone(state: string | undefined): BadgeTone {
  switch (state) {
    case "dynamic":
    case "file":
    case "sample":
      return "success";
    case "preview":
    case "stale":
      return "warning";
    case "error":
      return "error";
    default:
      return "info";
  }
}

function viewModeTone(mode: ArchitectureView["mode"]): BadgeTone {
  switch (mode) {
    case "cross_region":
      return "info";
    case "focus":
      return "success";
    default:
      return "neutral";
  }
}

function AwsBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`aws-badge aws-badge-${tone}`}>{children}</span>;
}

function AwsStatus({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`aws-status aws-status-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

export function Dashboard({
  manifest,
  overlays = EMPTY_OVERLAYS,
  runtimeInfo,
  controlControlsVisible = false,
  controlApplyEnabled = false,
  onControlUpdated,
  toolbarSlot
}: DashboardProps) {
  const [activeViewId, setActiveViewId] = useState(manifest.views[0]?.id ?? "");
  const [visualMode, setVisualMode] = useState<VisualMode>("system");
  const [systemVisualMode, setSystemVisualMode] = useState<ResolvedVisualMode>(() => readSystemVisualMode());
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [edgeOverlayLabelsExpanded, setEdgeOverlayLabelsExpanded] = useState(true);
  const resolvedVisualMode = visualMode === "system" ? systemVisualMode : visualMode;

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

  useEffect(() => {
    document.body.dataset.visualMode = resolvedVisualMode;
  }, [resolvedVisualMode]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemMode = () => {
      setSystemVisualMode(colorSchemeQuery.matches ? "light" : "dark");
    };

    updateSystemMode();
    colorSchemeQuery.addEventListener("change", updateSystemMode);
    return () => colorSchemeQuery.removeEventListener("change", updateSystemMode);
  }, []);

  if (modelResult.error || !modelResult.model || !modelResult.overlayModel) {
    return <ErrorPanel title="Invalid architecture data" message={modelResult.error ?? "Graph model failed to build"} />;
  }

  const model = modelResult.model;
  const overlayModel = modelResult.overlayModel;
  const activeView = model.viewById.get(activeViewId) ?? manifest.views[0];
  const overlayState = runtimeInfo?.previewActive ? "preview" : runtimeInfo?.overlayStatus.state;

  return (
    <div className={`cloudscape-app-shell ${navigationOpen ? "" : "is-navigation-closed"}`} data-visual-mode={resolvedVisualMode}>
      <aside className="aws-side-navigation" aria-label="Primary navigation">
        <div className="aws-side-navigation-header">
          <span className="aws-shell-service">{PRODUCT_NAME}</span>
          <button
            type="button"
            className="aws-icon-button"
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
          >
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        </div>

        <section className="aws-nav-section" aria-labelledby="aws-nav-views">
          <div className="aws-nav-section-title" id="aws-nav-views">
            <span>Views</span>
            <AwsBadge tone="neutral">{manifest.views.length}</AwsBadge>
          </div>
          <div className="aws-nav-list">
            {manifest.views.map((view) => (
              <button
                key={view.id}
                type="button"
                className={`aws-nav-item ${view.id === activeView.id ? "is-active" : ""}`}
                aria-current={view.id === activeView.id ? "page" : undefined}
                onClick={() => setActiveViewId(view.id)}
              >
                <span>{view.label}</span>
                <AwsBadge tone={viewModeTone(view.mode)}>{VIEW_MODE_LABEL[view.mode]}</AwsBadge>
              </button>
            ))}
          </div>
        </section>

        <section className="aws-nav-section" aria-labelledby="aws-nav-legend">
          <div className="aws-nav-section-title" id="aws-nav-legend">
            <span>Edge legend</span>
          </div>
          <div className="aws-nav-list aws-nav-list-compact">
            {EDGE_LEGEND.map((item) => (
              <div className="aws-nav-item aws-nav-item-static" key={item.label}>
                <span>{item.label}</span>
                <AwsBadge tone={item.tone}>{item.chip}</AwsBadge>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <section className="aws-workspace">
        <header className="aws-content-header">
          <button
            type="button"
            className="aws-navigation-toggle"
            aria-label="Open navigation"
            onClick={() => setNavigationOpen(true)}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="aws-content-heading">
            <p className="aws-content-breadcrumb">{PRODUCT_TAGLINE}</p>
            <h1 data-testid="dashboard-title">{PRODUCT_NAME}</h1>
            <p>{PRODUCT_DESCRIPTION}</p>
          </div>
          <div className="aws-content-actions">
            <label className="cloudscape-native-view-picker">
              <span>View</span>
              <select value={activeView.id} onChange={(event) => setActiveViewId(event.target.value)}>
                {manifest.views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="aws-segmented-control" role="group" aria-label="Visual mode">
              <button
                type="button"
                className={visualMode === "system" ? "is-selected" : ""}
                aria-pressed={visualMode === "system"}
                onClick={() => setVisualMode("system")}
              >
                System
              </button>
              <button
                type="button"
                className={visualMode === "dark" ? "is-selected" : ""}
                aria-pressed={visualMode === "dark"}
                onClick={() => setVisualMode("dark")}
              >
                Dark
              </button>
              <button
                type="button"
                className={visualMode === "light" ? "is-selected" : ""}
                aria-pressed={visualMode === "light"}
                onClick={() => setVisualMode("light")}
              >
                Light
              </button>
            </div>
            <label className="aws-toggle-control">
              <input
                type="checkbox"
                checked={edgeOverlayLabelsExpanded}
                onChange={(event) => setEdgeOverlayLabelsExpanded(event.target.checked)}
              />
              <span>Overlay labels</span>
            </label>
            {toolbarSlot}
          </div>
        </header>

        {runtimeInfo ? (
          <section className="aws-status-strip" aria-label="Overlay runtime status">
            <div className="aws-kv">
              <span>State</span>
              <AwsStatus tone={statusTone(overlayState)}>{overlayState}</AwsStatus>
            </div>
            <div className="aws-kv">
              <span>Revision</span>
              <b>r{runtimeInfo.overlayRevision}</b>
            </div>
            <div className="aws-kv">
              <span>Source</span>
              <b>{runtimeInfo.overlaySource}</b>
            </div>
            <div className="aws-kv">
              <span>Updated</span>
              <b>{formatOverlayTime(runtimeInfo.overlayGeneratedAt)}</b>
            </div>
            {runtimeInfo.graphControlsVisible ? (
              <div className="aws-kv aws-kv-wide">
                <AwsBadge tone={runtimeInfo.graphControlApplyEnabled ? "info" : "warning"}>
                  Graph Controls {runtimeInfo.graphControlApplyEnabled ? "Apply Enabled" : "Visible Only"}
                </AwsBadge>
                <b>
                  {runtimeInfo.graphControlApplyEnabled
                    ? "Async apply handler is enabled; effective values update after observation."
                    : "Control cards are visible, but Apply is disabled until backend integration is enabled."}
                </b>
              </div>
            ) : null}
          </section>
        ) : null}

        <main className="cloudscape-dashboard-content" aria-label={`${PRODUCT_NAME} view ${activeView.id}`}>
          <ViewBody
            activeView={activeView}
            model={model}
            overlayModel={overlayModel}
            controlControlsVisible={controlControlsVisible && !runtimeInfo?.previewActive}
            controlApplyEnabled={controlApplyEnabled && !runtimeInfo?.previewActive}
            edgeOverlayLabelsExpanded={edgeOverlayLabelsExpanded}
            onControlUpdated={onControlUpdated}
          />
        </main>
      </section>
    </div>
  );
}

export { ErrorPanel };
