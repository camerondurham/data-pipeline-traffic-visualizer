import { useEffect, useState } from "react";
import { parse } from "yaml";
import { Dashboard, ErrorPanel } from "./Dashboard";
import { formatValidationError, validateArchitectureManifest, type ArchitectureManifest } from "./zod";

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

export default function App() {
  const [manifest, setManifest] = useState<ArchitectureManifest>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    loadArchitectureManifest()
      .then((loaded) => {
        if (!cancelled) {
          setManifest(loaded);
          setError(undefined);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(formatValidationError(loadError));
          setManifest(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorPanel title="Unable to load architecture.yaml" message={error} />;
  }

  if (!manifest) {
    return (
      <main className="load-state">
        <h1>Loading architecture topology</h1>
      </main>
    );
  }

  return <Dashboard manifest={manifest} />;
}
