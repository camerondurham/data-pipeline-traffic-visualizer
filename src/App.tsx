import { useEffect, useRef, useState } from "react";
import { parse } from "yaml";
import { Dashboard, ErrorPanel } from "./Dashboard";
import { ArchitectureEditor } from "./ArchitectureEditor";
import { PRODUCT_NAME } from "./branding";
import { hasArchitectureDeepLink, loadArchitectureDeepLink } from "./deepLinkArchitecture";
import {
  persistDemoThrottleValue,
  resetDemoThrottleValues,
  restoreDemoThrottleValues
} from "./demoControls";
import architectureYaml from "../data/sample/architecture.yaml?raw";
import overlaysYaml from "../data/sample/architecture-overlays.yaml?raw";
import { validateOverlayReferences } from "./overlays";
import {
  formatValidationError,
  validateArchitectureManifest,
  validateArchitectureOverlays,
  type ArchitectureManifest,
  type ArchitectureOverlays
} from "./zod";
import type {
  ArchitectureSourcePayload,
  OverlayControlValueUpdateRequest,
  RuntimeArchitecturePayload
} from "./runtime/types";

type EditorBackend = "server" | "browser";

interface ArchitectureLoadResult {
  payload: RuntimeArchitecturePayload;
  editorBackend: EditorBackend;
  source?: ArchitectureSourcePayload;
}

interface AppError {
  title: string;
  message: string;
}

const DEMO_CONTROL_APPLY_DELAY_MS = 350;

function loadErrorFor(error: unknown): AppError {
  return {
    title: hasArchitectureDeepLink() ? "Unable to load deep-link architecture" : "Unable to load runtime architecture",
    message: formatValidationError(error)
  };
}

function isStaticDemo(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === "1";
}

function readStaticSource() {
  return {
    architectureYaml,
    overlaysYaml
  };
}

function parseStaticArchitectureSource(source: { architectureYaml: string; overlaysYaml: string }): {
  manifest: ArchitectureManifest;
  overlays: ArchitectureOverlays;
} {
  const manifest = validateArchitectureManifest(parse(source.architectureYaml));
  const overlays = validateArchitectureOverlays(parse(source.overlaysYaml));
  validateOverlayReferences(manifest, overlays);
  return { manifest, overlays };
}

async function loadStaticArchitecture(): Promise<RuntimeArchitecturePayload> {
  const parsed = parseStaticArchitectureSource(readStaticSource());
  const restored = restoreDemoThrottleValues(parsed.overlays);
  const restoredAt = restored.restoredCount > 0 ? new Date().toISOString() : new Date(0).toISOString();

  return {
    manifest: parsed.manifest,
    overlays: restored.overlays,
    architectureRevision: 1,
    overlayRevision: restored.restoredCount > 0 ? 2 : 1,
    overlayGeneratedAt: restoredAt,
    overlaySource: restored.restoredCount > 0 ? "browser throttle simulation" : "sample static demo",
    overlayStatus: { state: restored.restoredCount > 0 ? "dynamic" : "sample" },
    editorEnabled: true,
    graphControlsVisible: true,
    graphControlApplyEnabled: true
  };
}

function transitionDemoThrottle(
  manifest: ArchitectureManifest,
  overlays: ArchitectureOverlays,
  request: OverlayControlValueUpdateRequest,
  phase: "applying" | "applied",
  timestamp: string
): ArchitectureOverlays {
  if (!Object.hasOwn(request, "desiredValue")) {
    throw new Error("A simulated throttle value is required");
  }
  if (Object.hasOwn(request, "priority")) {
    throw new Error("Priority is not editable in the browser simulation");
  }

  const control = overlays.controls.find((candidate) => candidate.id === request.controlId);
  if (!control) {
    throw new Error(`Control ${request.controlId} does not exist`);
  }
  if (control.control_type !== "throttle") {
    throw new Error(`Control ${request.controlId} is not a throttle`);
  }

  const next = validateArchitectureOverlays({
    ...overlays,
    controls: overlays.controls.map((candidate) =>
      candidate.id === request.controlId
        ? {
            ...candidate,
            state: {
              ...candidate.state,
              desired_value: request.desiredValue,
              ...(phase === "applied" ? { effective_value: request.desiredValue } : {}),
              apply:
                phase === "applying"
                  ? {
                      phase,
                      requested_at: timestamp,
                      message: "Simulating processor throttle update."
                    }
                  : {
                      phase,
                      requested_at: candidate.state.apply.requested_at ?? timestamp,
                      observed_at: timestamp,
                      message: "Browser-local simulated value applied."
                    }
            }
          }
        : candidate
    )
  });
  validateOverlayReferences(manifest, next);
  return next;
}

async function loadArchitecture(): Promise<ArchitectureLoadResult> {
  const deepLinkArchitecture = loadArchitectureDeepLink();

  if (deepLinkArchitecture) {
    return {
      payload: deepLinkArchitecture.payload,
      source: deepLinkArchitecture.source,
      editorBackend: "browser"
    };
  }

  if (isStaticDemo()) {
    return {
      payload: await loadStaticArchitecture(),
      source: readStaticSource(),
      editorBackend: "browser"
    };
  }

  const response = await fetch(`/api/architecture?refresh=${Date.now()}`, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load runtime architecture: ${response.status}`);
  }

  const payload = (await response.json()) as RuntimeArchitecturePayload;
  const manifest = validateArchitectureManifest(payload.manifest);
  const overlays = validateArchitectureOverlays(payload.overlays);
  validateOverlayReferences(manifest, overlays);

  return {
    payload: {
      ...payload,
      manifest,
      overlays,
      graphControlsVisible: Boolean(payload.graphControlsVisible),
      graphControlApplyEnabled: Boolean(payload.graphControlApplyEnabled)
    },
    editorBackend: "server"
  };
}

export default function App() {
  const [runtimePayload, setRuntimePayload] = useState<RuntimeArchitecturePayload>();
  const [editorBackend, setEditorBackend] = useState<EditorBackend>("server");
  const [source, setSource] = useState<ArchitectureSourcePayload>();
  const [preview, setPreview] = useState<{ manifest: ArchitectureManifest; overlays: ArchitectureOverlays }>();
  const [error, setError] = useState<AppError>();
  const demoControlApplies = useRef(new Set<string>());
  const demoControlGeneration = useRef(0);

  function applyLoadResult(result: ArchitectureLoadResult): void {
    setRuntimePayload(result.payload);
    setEditorBackend(result.editorBackend);
    setSource(result.source);
    setError(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    let events: EventSource | undefined;

    const refresh = () =>
      loadArchitecture()
        .then((result) => {
          if (!cancelled) {
            applyLoadResult(result);
          }
        })
        .catch((loadError: unknown) => {
          if (!cancelled) {
            setError(loadErrorFor(loadError));
            setRuntimePayload(undefined);
            setSource(undefined);
            setPreview(undefined);
          }
        });

    function closeEvents(): void {
      events?.close();
      events = undefined;
    }

    function syncEvents(): void {
      closeEvents();
      if (!isStaticDemo() && !hasArchitectureDeepLink() && typeof EventSource !== "undefined") {
        events = new EventSource("/api/architecture/events");
        events.addEventListener("revision", () => {
          if (!cancelled) {
            void refresh();
          }
        });
      }
    }

    function syncLocation(): void {
      void refresh();
      syncEvents();
    }

    syncLocation();
    window.addEventListener("hashchange", syncLocation);

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", syncLocation);
      closeEvents();
    };
  }, []);

  if (error) {
    return <ErrorPanel title={error.title} message={error.message} />;
  }

  if (!runtimePayload) {
    return (
      <main className="load-state">
        <h1>Loading {PRODUCT_NAME}</h1>
      </main>
    );
  }

  const loadedPayload = runtimePayload;
  const manifest = preview?.manifest ?? loadedPayload.manifest;
  const overlays = preview?.overlays ?? loadedPayload.overlays;
  const demoControlSimulation = isStaticDemo() && !hasArchitectureDeepLink() && editorBackend === "browser";

  async function applyDemoControl(request: OverlayControlValueUpdateRequest): Promise<void> {
    if (demoControlApplies.current.has(request.controlId)) {
      throw new Error(`Control ${request.controlId} already has a simulated apply in flight`);
    }

    const applyingAt = new Date().toISOString();
    let applyingOverlays: ArchitectureOverlays;
    try {
      applyingOverlays = transitionDemoThrottle(
        loadedPayload.manifest,
        loadedPayload.overlays,
        request,
        "applying",
        applyingAt
      );
    } catch (applyError) {
      throw new Error(formatValidationError(applyError));
    }

    const applyingControl = applyingOverlays.controls.find((control) => control.id === request.controlId);
    if (typeof applyingControl?.state.desired_value !== "number") {
      throw new Error("Simulated throttle values must be numeric");
    }
    const desiredValue = applyingControl.state.desired_value;
    const applyGeneration = demoControlGeneration.current;

    demoControlApplies.current.add(request.controlId);
    setRuntimePayload((current) => {
      if (!current) {
        return current;
      }
      const nextOverlays = transitionDemoThrottle(
        current.manifest,
        current.overlays,
        request,
        "applying",
        applyingAt
      );
      return {
        ...current,
        overlays: nextOverlays,
        overlayRevision: current.overlayRevision + 1,
        overlayGeneratedAt: applyingAt,
        overlaySource: "browser throttle simulation",
        overlayStatus: { state: "dynamic" }
      };
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, DEMO_CONTROL_APPLY_DELAY_MS));
      if (applyGeneration !== demoControlGeneration.current) {
        return;
      }
      const observedAt = new Date().toISOString();
      persistDemoThrottleValue(request.controlId, desiredValue);
      setRuntimePayload((current) => {
        if (!current) {
          return current;
        }
        const appliedOverlays = transitionDemoThrottle(
          current.manifest,
          current.overlays,
          { ...request, desiredValue },
          "applied",
          observedAt
        );
        return {
          ...current,
          overlays: appliedOverlays,
          overlayRevision: current.overlayRevision + 1,
          overlayGeneratedAt: observedAt,
          overlaySource: "browser throttle simulation",
          overlayStatus: { state: "dynamic" }
        };
      });
    } finally {
      if (applyGeneration === demoControlGeneration.current) {
        demoControlApplies.current.delete(request.controlId);
      }
    }
  }

  async function resetDemoControls(): Promise<void> {
    demoControlGeneration.current += 1;
    demoControlApplies.current.clear();
    resetDemoThrottleValues();
    applyLoadResult(await loadArchitecture());
  }

  return (
    <Dashboard
      manifest={manifest}
      overlays={overlays}
      runtimeInfo={{ ...runtimePayload, previewActive: Boolean(preview) }}
      controlControlsVisible={runtimePayload.graphControlsVisible && !preview}
      controlApplyEnabled={runtimePayload.graphControlApplyEnabled && !preview}
      controlSimulation={demoControlSimulation}
      onControlApply={demoControlSimulation ? applyDemoControl : undefined}
      onControlUpdated={
        editorBackend === "server"
          ? () =>
              loadArchitecture()
                .then(applyLoadResult)
                .catch((loadError: unknown) => setError(loadErrorFor(loadError)))
          : undefined
      }
      onResetControls={demoControlSimulation ? resetDemoControls : undefined}
      toolbarSlot={
        <ArchitectureEditor
          enabled={runtimePayload.editorEnabled}
          backend={editorBackend}
          manifest={manifest}
          overlays={overlays}
          source={source}
          onPreview={setPreview}
          onApplied={() => {
            setPreview(undefined);
            void loadArchitecture()
              .then(applyLoadResult)
              .catch((loadError: unknown) => setError(loadErrorFor(loadError)));
          }}
        />
      }
    />
  );
}
