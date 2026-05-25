import { useEffect, useState } from "react";
import { parse } from "yaml";
import { Dashboard, ErrorPanel } from "./Dashboard";
import { validateOverlayReferences } from "./overlays";
import {
  formatValidationError,
  validateArchitectureManifest,
  validateArchitectureOverlays,
  type ArchitectureManifest,
  type ArchitectureOverlays
} from "./zod";

async function loadArchitectureManifest(): Promise<ArchitectureManifest> {
  const response = await fetch(`/architecture.yaml?refresh=${Date.now()}`, {
    headers: { Accept: "application/yaml,text/yaml,text/plain" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load public/architecture.yaml: ${response.status}`);
  }

  const text = await response.text();
  const yaml = parse(text);
  return validateArchitectureManifest(yaml);
}

async function loadArchitectureOverlays(): Promise<ArchitectureOverlays> {
  const response = await fetch(`/architecture-overlays.yaml?refresh=${Date.now()}`, {
    headers: { Accept: "application/yaml,text/yaml,text/plain" }
  });

  if (!response.ok) {
    throw new Error(`Failed to load public/architecture-overlays.yaml: ${response.status}`);
  }

  const text = await response.text();
  try {
    const yaml = parse(text);
    return validateArchitectureOverlays(yaml);
  } catch (error) {
    throw new Error(`public/architecture-overlays.yaml: ${formatValidationError(error)}`);
  }
}

export default function App() {
  const [manifest, setManifest] = useState<ArchitectureManifest>();
  const [overlays, setOverlays] = useState<ArchitectureOverlays>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    loadArchitectureManifest()
      .then(async (loadedManifest) => {
        const loadedOverlays = await loadArchitectureOverlays();
        try {
          validateOverlayReferences(loadedManifest, loadedOverlays);
        } catch (error) {
          throw new Error(`public/architecture-overlays.yaml: ${formatValidationError(error)}`);
        }
        return { loadedManifest, loadedOverlays };
      })
      .then(({ loadedManifest, loadedOverlays }) => {
        if (!cancelled) {
          setManifest(loadedManifest);
          setOverlays(loadedOverlays);
          setError(undefined);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(formatValidationError(loadError));
          setManifest(undefined);
          setOverlays(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    const title = error.includes("architecture-overlays")
      ? "Unable to load architecture-overlays.yaml"
      : "Unable to load architecture.yaml";
    return <ErrorPanel title={title} message={error} />;
  }

  if (!manifest || !overlays) {
    return (
      <main className="load-state">
        <h1>Loading architecture topology</h1>
      </main>
    );
  }

  return <Dashboard manifest={manifest} overlays={overlays} />;
}
