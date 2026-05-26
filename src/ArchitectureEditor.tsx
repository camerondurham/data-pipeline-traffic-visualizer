import { useEffect, useState } from "react";
import { CheckCircle2, Code2, RotateCcw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { stringify } from "yaml";
import { lintArchitectureDocuments } from "./server/runtimeValidation";
import type { ArchitectureManifest, ArchitectureOverlays } from "./zod";
import type { ArchitectureLintResponse, ArchitectureSourcePayload, RuntimeDiagnostic } from "./runtime/types";

type EditorBackend = "server" | "browser";

interface ArchitectureEditorProps {
  enabled: boolean;
  backend?: EditorBackend;
  manifest: ArchitectureManifest;
  overlays: ArchitectureOverlays;
  source?: ArchitectureSourcePayload;
  onPreview: (preview: { manifest: ArchitectureManifest; overlays: ArchitectureOverlays } | undefined) => void;
  onApplied: () => void;
  onBrowserApply?: (source: ArchitectureSourcePayload, result: ArchitectureLintResponse) => void;
  onBrowserReset?: () => void;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function diagnosticLabel(diagnostic: RuntimeDiagnostic): string {
  const path = diagnostic.path ? ` ${diagnostic.path}` : "";
  return `${diagnostic.file}${path}: ${diagnostic.message}`;
}

export function ArchitectureEditor({
  enabled,
  backend = "server",
  manifest,
  overlays,
  source,
  onPreview,
  onApplied,
  onBrowserApply,
  onBrowserReset
}: ArchitectureEditorProps) {
  const [open, setOpen] = useState(false);
  const [architectureYaml, setArchitectureYaml] = useState("");
  const [overlaysYaml, setOverlaysYaml] = useState("");
  const [lintResult, setLintResult] = useState<ArchitectureLintResponse>();
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(false);

  const hasSource = architectureYaml.length > 0 || overlaysYaml.length > 0;
  const canApply = Boolean(lintResult?.ok && hasSource && enabled);

  const diagnostics = lintResult?.diagnostics ?? [];

  useEffect(() => {
    if (!open || hasSource) {
      return;
    }

    setArchitectureYaml(stringify(manifest));
    setOverlaysYaml(stringify(overlays));
    setStatus("Loaded currently rendered model");
  }, [open, hasSource, manifest, overlays]);

  useEffect(() => {
    if (!open || !enabled || !hasSource) {
      return;
    }

    const timer = setTimeout(() => {
      void lintSource(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [open, enabled, architectureYaml, overlaysYaml]);

  if (!enabled) {
    return null;
  }

  async function loadSource(): Promise<void> {
    setLoading(true);
    setStatus(undefined);
    try {
      if (backend === "browser") {
        setArchitectureYaml(source?.architectureYaml ?? stringify(manifest));
        setOverlaysYaml(source?.overlaysYaml ?? stringify(overlays));
        setStatus("Loaded browser demo source");
        return;
      }

      const response = await fetch("/api/architecture/source");
      const runtimeSource = await readJson<ArchitectureSourcePayload>(response);
      setArchitectureYaml(runtimeSource.architectureYaml);
      setOverlaysYaml(runtimeSource.overlaysYaml);
      setStatus("Loaded active runtime source");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load source");
    } finally {
      setLoading(false);
    }
  }

  async function lintSource(showStatus = true): Promise<void> {
    if (!enabled || !hasSource) {
      return;
    }

    try {
      if (backend === "browser") {
        const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
        setLintResult(result);
        if (result.ok && result.manifest && result.overlays) {
          onPreview({ manifest: result.manifest, overlays: result.overlays });
          if (showStatus) {
            setStatus("Previewing validated browser draft");
          }
        } else {
          onPreview(undefined);
          if (showStatus) {
            setStatus("Draft has validation errors");
          }
        }
        return;
      }

      const response = await fetch("/api/architecture/lint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ architectureYaml, overlaysYaml })
      });
      const result = await readJson<ArchitectureLintResponse>(response);
      setLintResult(result);
      if (result.ok && result.manifest && result.overlays) {
        onPreview({ manifest: result.manifest, overlays: result.overlays });
        if (showStatus) {
          setStatus("Previewing validated draft");
        }
      } else {
        onPreview(undefined);
        if (showStatus) {
          setStatus("Draft has validation errors");
        }
      }
    } catch (error) {
      onPreview(undefined);
      setStatus(error instanceof Error ? error.message : "Unable to lint draft");
    }
  }

  async function applyDraft(): Promise<void> {
    setLoading(true);
    setStatus(undefined);
    try {
      if (backend === "browser") {
        const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
        setLintResult(result);
        if (!result.ok) {
          onPreview(undefined);
          setStatus("Draft has validation errors");
          return;
        }

        onBrowserApply?.({ architectureYaml, overlaysYaml }, result);
        onPreview(undefined);
        setStatus("Browser draft saved");
        onApplied();
        return;
      }

      const response = await fetch("/api/architecture/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ architectureYaml, overlaysYaml })
      });
      const result = await readJson<ArchitectureLintResponse>(response);
      setLintResult(result);
      if (!result.ok) {
        onPreview(undefined);
        setStatus("Draft has validation errors");
        return;
      }
      onPreview(undefined);
      setStatus("Runtime draft applied");
      onApplied();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to apply draft");
    } finally {
      setLoading(false);
    }
  }

  async function resetDraft(): Promise<void> {
    setLoading(true);
    setStatus(undefined);
    try {
      if (backend === "browser") {
        onBrowserReset?.();
        onPreview(undefined);
        setArchitectureYaml("");
        setOverlaysYaml("");
        setLintResult(undefined);
        setStatus("Browser draft reset");
        onApplied();
        return;
      }

      const response = await fetch("/api/architecture/draft", {
        method: "DELETE"
      });
      if (!response.ok) {
        await readJson(response);
      }
      onPreview(undefined);
      setArchitectureYaml("");
      setOverlaysYaml("");
      setLintResult(undefined);
      setStatus("Runtime draft reset");
      onApplied();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to reset draft");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="architecture-editor">
      <button className="icon-button editor-toggle" type="button" onClick={() => setOpen((current) => !current)}>
        <Code2 size={18} aria-hidden="true" />
        <span>Runtime YAML</span>
      </button>

      {open ? (
        <section className="editor-panel" aria-label="Runtime architecture editor">
          <div className="editor-header">
            <div>
              <span className="eyebrow">Runtime Editor</span>
              <h2>Architecture and overlays</h2>
            </div>
            {lintResult?.ok ? (
              <CheckCircle2 className="editor-state is-valid" size={20} aria-label="Valid draft" />
            ) : diagnostics.length ? (
              <XCircle className="editor-state is-invalid" size={20} aria-label="Invalid draft" />
            ) : null}
          </div>

          <div className="editor-actions">
            <button type="button" onClick={loadSource} disabled={!enabled || loading}>
              <ShieldCheck size={16} aria-hidden="true" />
              Load
            </button>
            <button type="button" onClick={() => void lintSource()} disabled={!enabled || !hasSource || loading}>
              <CheckCircle2 size={16} aria-hidden="true" />
              Lint
            </button>
            <button type="button" onClick={applyDraft} disabled={!canApply || loading}>
              <Upload size={16} aria-hidden="true" />
              Apply
            </button>
            <button type="button" onClick={resetDraft} disabled={!enabled || loading}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset
            </button>
          </div>

          <div className="editor-grid">
            <label>
              <span>architecture.yaml</span>
              <textarea
                aria-label="architecture.yaml"
                value={architectureYaml}
                onChange={(event) => setArchitectureYaml(event.target.value)}
                spellCheck={false}
              />
            </label>
            <label>
              <span>architecture-overlays.yaml</span>
              <textarea
                aria-label="architecture-overlays.yaml"
                value={overlaysYaml}
                onChange={(event) => setOverlaysYaml(event.target.value)}
                spellCheck={false}
              />
            </label>
          </div>

          {diagnostics.length ? (
            <ul className="diagnostics" aria-label="Runtime YAML diagnostics">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.file}-${diagnostic.path ?? "root"}-${index}`}>{diagnosticLabel(diagnostic)}</li>
              ))}
            </ul>
          ) : null}

          {status ? <p className="editor-status">{status}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
