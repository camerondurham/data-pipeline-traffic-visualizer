import { useEffect, useState } from "react";
import { parse } from "yaml";
import { Dashboard, ErrorPanel } from "./Dashboard";
import { ArchitectureEditor } from "./ArchitectureEditor";
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
import type { RuntimeArchitecturePayload } from "./runtime/types";

const STATIC_ARCHITECTURE_STORAGE_KEY = "architecture-demo:architectureYaml";
const STATIC_OVERLAYS_STORAGE_KEY = "architecture-demo:overlaysYaml";

function isStaticDemo(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === "1";
}

function readStaticSource() {
  if (typeof localStorage === "undefined") {
    return {
      architectureYaml,
      overlaysYaml
    };
  }

  return {
    architectureYaml: localStorage.getItem(STATIC_ARCHITECTURE_STORAGE_KEY) ?? architectureYaml,
    overlaysYaml: localStorage.getItem(STATIC_OVERLAYS_STORAGE_KEY) ?? overlaysYaml
  };
}

function writeStaticSource(source: { architectureYaml: string; overlaysYaml: string }): void {
  localStorage.setItem(STATIC_ARCHITECTURE_STORAGE_KEY, source.architectureYaml);
  localStorage.setItem(STATIC_OVERLAYS_STORAGE_KEY, source.overlaysYaml);
}

function resetStaticSource(): void {
  localStorage.removeItem(STATIC_ARCHITECTURE_STORAGE_KEY);
  localStorage.removeItem(STATIC_OVERLAYS_STORAGE_KEY);
}

async function loadStaticArchitecture(): Promise<RuntimeArchitecturePayload> {
  const source = readStaticSource();
  const manifest = validateArchitectureManifest(parse(source.architectureYaml));
  const overlays = validateArchitectureOverlays(parse(source.overlaysYaml));
  validateOverlayReferences(manifest, overlays);
  const usingDraft =
    source.architectureYaml !== architectureYaml ||
    source.overlaysYaml !== overlaysYaml;

  return {
    manifest,
    overlays,
    architectureRevision: 1,
    overlayRevision: usingDraft ? 2 : 1,
    overlayGeneratedAt: new Date(0).toISOString(),
    overlaySource: usingDraft ? "browser draft" : "sample static demo",
    overlayStatus: { state: usingDraft ? "dynamic" : "sample" },
    editorEnabled: true
  };
}

async function loadRuntimeArchitecture(): Promise<RuntimeArchitecturePayload> {
  if (isStaticDemo()) {
    return loadStaticArchitecture();
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
    ...payload,
    manifest,
    overlays
  };
}

export default function App() {
  const [runtimePayload, setRuntimePayload] = useState<RuntimeArchitecturePayload>();
  const [preview, setPreview] = useState<{ manifest: ArchitectureManifest; overlays: ArchitectureOverlays }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    const refresh = () =>
      loadRuntimeArchitecture()
        .then((payload) => {
          if (!cancelled) {
            setRuntimePayload(payload);
            setError(undefined);
          }
        })
        .catch((loadError: unknown) => {
          if (!cancelled) {
            setError(formatValidationError(loadError));
            setRuntimePayload(undefined);
            setPreview(undefined);
          }
        });

    void refresh();

    let events: EventSource | undefined;
    if (!isStaticDemo() && typeof EventSource !== "undefined") {
      events = new EventSource("/api/architecture/events");
      events.addEventListener("revision", () => {
        if (!cancelled) {
          void refresh();
        }
      });
    }

    return () => {
      cancelled = true;
      events?.close();
    };
  }, []);

  if (error) {
    return <ErrorPanel title="Unable to load runtime architecture" message={error} />;
  }

  if (!runtimePayload) {
    return (
      <main className="load-state">
        <h1>Loading architecture topology</h1>
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
      toolbarSlot={
        <ArchitectureEditor
          enabled={runtimePayload.editorEnabled}
          backend={isStaticDemo() ? "browser" : "server"}
          manifest={manifest}
          overlays={overlays}
          source={isStaticDemo() ? readStaticSource() : undefined}
          onPreview={setPreview}
          onBrowserApply={(source) => writeStaticSource(source)}
          onBrowserReset={resetStaticSource}
          onApplied={() => {
            setPreview(undefined);
            void loadRuntimeArchitecture()
              .then(setRuntimePayload)
              .catch((loadError: unknown) => setError(formatValidationError(loadError)));
          }}
        />
      }
    />
  );
}
