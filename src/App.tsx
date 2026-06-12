import { useEffect, useState } from "react";
import { parse } from "yaml";
import { Dashboard, ErrorPanel } from "./Dashboard";
import { ArchitectureEditor } from "./ArchitectureEditor";
import { PRODUCT_NAME } from "./branding";
import { hasArchitectureDeepLink, loadArchitectureDeepLink } from "./deepLinkArchitecture";
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
import type { ArchitectureSourcePayload, RuntimeArchitecturePayload } from "./runtime/types";

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

  return {
    manifest: parsed.manifest,
    overlays: parsed.overlays,
    architectureRevision: 1,
    overlayRevision: 1,
    overlayGeneratedAt: new Date(0).toISOString(),
    overlaySource: "sample static demo",
    overlayStatus: { state: "sample" },
    editorEnabled: true,
    graphControlsVisible: false,
    graphControlApplyEnabled: false
  };
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

  const manifest = preview?.manifest ?? runtimePayload.manifest;
  const overlays = preview?.overlays ?? runtimePayload.overlays;

  return (
    <Dashboard
      manifest={manifest}
      overlays={overlays}
      runtimeInfo={{ ...runtimePayload, previewActive: Boolean(preview) }}
      controlControlsVisible={runtimePayload.graphControlsVisible && editorBackend === "server" && !preview}
      controlApplyEnabled={runtimePayload.graphControlApplyEnabled && editorBackend === "server" && !preview}
      onControlUpdated={() =>
        loadArchitecture()
          .then(applyLoadResult)
          .catch((loadError: unknown) => setError(loadErrorFor(loadError)))
      }
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
