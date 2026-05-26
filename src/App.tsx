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

function isStaticDemo(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === "1";
}

async function loadStaticArchitecture(): Promise<RuntimeArchitecturePayload> {
  const manifest = validateArchitectureManifest(parse(architectureYaml));
  const overlays = validateArchitectureOverlays(parse(overlaysYaml));
  validateOverlayReferences(manifest, overlays);

  return {
    manifest,
    overlays,
    architectureRevision: 1,
    overlayRevision: 1,
    overlayGeneratedAt: new Date(0).toISOString(),
    overlaySource: "sample static demo",
    overlayStatus: { state: "sample" },
    editorEnabled: false
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
        isStaticDemo() ? null : (
          <ArchitectureEditor
            enabled={runtimePayload.editorEnabled}
            manifest={manifest}
            overlays={overlays}
            onPreview={setPreview}
            onApplied={() => {
              setPreview(undefined);
              void loadRuntimeArchitecture()
                .then(setRuntimePayload)
                .catch((loadError: unknown) => setError(formatValidationError(loadError)));
            }}
          />
        )
      }
    />
  );
}
