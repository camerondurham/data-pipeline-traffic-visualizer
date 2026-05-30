import { useEffect, useState } from "react";
import { stringify } from "yaml";
import { lintArchitectureDocuments } from "./server/runtimeValidation";
import type { ArchitectureManifest, ArchitectureOverlays } from "./zod";
import type { ArchitectureLintResponse, ArchitectureSourcePayload, RuntimeDiagnostic } from "./runtime/types";

type EditorBackend = "server" | "browser";
type EditorStatusTone = "info" | "success" | "error";

interface EditorStatus {
  message: string;
  tone: EditorStatusTone;
}

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

function editorStateLabel(isValid: boolean, hasDiagnostics: boolean): string | undefined {
  if (isValid) {
    return "Valid draft";
  }
  if (hasDiagnostics) {
    return "Invalid draft";
  }
  return undefined;
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
  const [status, setStatus] = useState<EditorStatus>();
  const [loading, setLoading] = useState(false);

  const hasSource = architectureYaml.length > 0 || overlaysYaml.length > 0;
  const canApply = Boolean(lintResult?.ok && hasSource && enabled);

  const diagnostics = lintResult?.diagnostics ?? [];

  function setEditorStatus(message: string, tone: EditorStatusTone = "info"): void {
    setStatus({ message, tone });
  }

  useEffect(() => {
    if (!open || hasSource) {
      return;
    }

    setArchitectureYaml(stringify(manifest));
    setOverlaysYaml(stringify(overlays));
    setEditorStatus("Loaded currently rendered model");
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
        setEditorStatus("Loaded browser demo source");
        return;
      }

      const response = await fetch("/api/architecture/source");
      const runtimeSource = await readJson<ArchitectureSourcePayload>(response);
      setArchitectureYaml(runtimeSource.architectureYaml);
      setOverlaysYaml(runtimeSource.overlaysYaml);
      setEditorStatus("Loaded active runtime source");
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : "Unable to load source", "error");
    } finally {
      setLoading(false);
    }
  }

  async function lintSource(announceStatus = true): Promise<void> {
    if (!enabled || !hasSource) {
      return;
    }

    try {
      if (backend === "browser") {
        const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
        setLintResult(result);
        if (result.ok && result.manifest && result.overlays) {
          onPreview({ manifest: result.manifest, overlays: result.overlays });
          if (announceStatus) {
            setEditorStatus("Previewing validated browser draft", "success");
          }
        } else {
          onPreview(undefined);
          if (announceStatus) {
            setEditorStatus("Draft has validation errors", "error");
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
        if (announceStatus) {
          setEditorStatus("Previewing validated draft", "success");
        }
      } else {
        onPreview(undefined);
        if (announceStatus) {
          setEditorStatus("Draft has validation errors", "error");
        }
      }
    } catch (error) {
      onPreview(undefined);
      setEditorStatus(error instanceof Error ? error.message : "Unable to lint draft", "error");
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
          setEditorStatus("Draft has validation errors", "error");
          return;
        }

        onBrowserApply?.({ architectureYaml, overlaysYaml }, result);
        onPreview(undefined);
        setEditorStatus("Browser draft saved", "success");
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
        setEditorStatus("Draft has validation errors", "error");
        return;
      }
      onPreview(undefined);
      setEditorStatus("Runtime draft applied", "success");
      onApplied();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : "Unable to apply draft", "error");
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
        setEditorStatus("Browser draft reset");
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
      setEditorStatus("Runtime draft reset");
      onApplied();
    } catch (error) {
      setEditorStatus(error instanceof Error ? error.message : "Unable to reset draft", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="architecture-editor">
      <button
        type="button"
        className="aws-button aws-button-normal editor-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Runtime YAML
      </button>

      {open ? (
        <section className="editor-panel" aria-label="Runtime architecture editor">
          <div className="aws-container editor-container">
            <header className="editor-header">
              <div className="editor-title">
                <h2>Architecture and overlays</h2>
                <p>Edit the active architecture and overlay YAML against the same validation path used by the runtime API.</p>
              </div>
              <div className="editor-header-actions">
                {editorStateLabel(Boolean(lintResult?.ok), Boolean(diagnostics.length)) ? (
                  <span className={`editor-state ${lintResult?.ok ? "is-valid" : "is-invalid"}`}>
                    {editorStateLabel(Boolean(lintResult?.ok), Boolean(diagnostics.length))}
                  </span>
                ) : null}
                <div className="editor-actions">
                  <button type="button" className="aws-button aws-button-normal" onClick={() => void loadSource()} disabled={!enabled || loading}>
                    {loading ? "Loading" : "Load"}
                  </button>
                  <button
                    type="button"
                    className="aws-button aws-button-normal"
                    onClick={() => void lintSource()}
                    disabled={!enabled || !hasSource || loading}
                  >
                    Lint
                  </button>
                  <button type="button" className="aws-button aws-button-primary" onClick={() => void applyDraft()} disabled={!canApply || loading}>
                    Apply
                  </button>
                  <button type="button" className="aws-button aws-button-normal" onClick={() => void resetDraft()} disabled={!enabled || loading}>
                    Reset
                  </button>
                </div>
              </div>
            </header>
            <div className="editor-grid">
              <label className="aws-form-field">
                <span>architecture.yaml</span>
                <textarea
                  aria-label="architecture.yaml"
                  className="yaml-editor-textarea"
                  value={architectureYaml}
                  onChange={(event) => setArchitectureYaml(event.target.value)}
                  rows={24}
                  spellCheck={false}
                />
              </label>
              <label className="aws-form-field">
                <span>architecture-overlays.yaml</span>
                <textarea
                  aria-label="architecture-overlays.yaml"
                  className="yaml-editor-textarea"
                  value={overlaysYaml}
                  onChange={(event) => setOverlaysYaml(event.target.value)}
                  rows={24}
                  spellCheck={false}
                />
              </label>
            </div>

            {diagnostics.length ? (
              <div className="aws-alert aws-alert-error" role="alert">
                <h3>Runtime YAML diagnostics</h3>
                <ul className="diagnostics" aria-label="Runtime YAML diagnostics">
                  {diagnostics.map((diagnostic, index) => (
                    <li key={`${diagnostic.file}-${diagnostic.path ?? "root"}-${index}`}>{diagnosticLabel(diagnostic)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {status ? (
              <div className={`aws-alert aws-alert-${status.tone}`} role="status">
                {status.message}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
