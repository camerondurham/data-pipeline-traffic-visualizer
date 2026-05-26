import { parse } from "yaml";
import { ZodError } from "zod";
import { validateGraphReferences } from "../graphBuilder";
import { validateOverlayReferences } from "../overlays";
import {
  validateArchitectureManifest,
  validateArchitectureOverlays,
  type ArchitectureManifest,
  type ArchitectureOverlays
} from "../zod";
import type { RuntimeDiagnostic, RuntimeFile } from "../runtime/types";

export interface ValidatedArchitectureDocuments {
  manifest: ArchitectureManifest;
  overlays: ArchitectureOverlays;
}

export class RuntimeValidationError extends Error {
  readonly diagnostics: RuntimeDiagnostic[];

  constructor(message: string, diagnostics: RuntimeDiagnostic[]) {
    super(message);
    this.name = "RuntimeValidationError";
    this.diagnostics = diagnostics;
  }
}

function diagnosticsFor(file: RuntimeFile, error: unknown): RuntimeDiagnostic[] {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      file,
      severity: "error",
      path: issue.path.length ? issue.path.join(".") : undefined,
      message: issue.message
    }));
  }

  return [
    {
      file,
      severity: "error",
      message: error instanceof Error ? error.message : "Unknown validation error"
    }
  ];
}

function parseArchitectureYaml(architectureYaml: string): ArchitectureManifest {
  const manifest = validateArchitectureManifest(parse(architectureYaml));
  validateGraphReferences(manifest);
  return manifest;
}

function parseOverlayYaml(overlaysYaml: string): ArchitectureOverlays {
  return validateArchitectureOverlays(parse(overlaysYaml));
}

export function lintArchitectureDocuments(
  architectureYaml: string,
  overlaysYaml: string
): { ok: true; diagnostics: []; manifest: ArchitectureManifest; overlays: ArchitectureOverlays } | { ok: false; diagnostics: RuntimeDiagnostic[] } {
  const diagnostics: RuntimeDiagnostic[] = [];
  let manifest: ArchitectureManifest | undefined;
  let overlays: ArchitectureOverlays | undefined;

  try {
    manifest = parseArchitectureYaml(architectureYaml);
  } catch (error) {
    diagnostics.push(...diagnosticsFor("architecture", error));
  }

  try {
    overlays = parseOverlayYaml(overlaysYaml);
  } catch (error) {
    diagnostics.push(...diagnosticsFor("overlays", error));
  }

  if (manifest && overlays) {
    try {
      validateOverlayReferences(manifest, overlays);
    } catch (error) {
      diagnostics.push(...diagnosticsFor("overlays", error));
    }
  }

  if (diagnostics.length > 0 || !manifest || !overlays) {
    return { ok: false, diagnostics };
  }

  return { ok: true, diagnostics: [], manifest, overlays };
}

export function validateArchitectureDocuments(
  architectureYaml: string,
  overlaysYaml: string
): ValidatedArchitectureDocuments {
  const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
  if (!result.ok) {
    throw new RuntimeValidationError("Architecture documents failed validation", result.diagnostics);
  }

  return {
    manifest: result.manifest,
    overlays: result.overlays
  };
}

export function validateOverlaySnapshot(
  manifest: ArchitectureManifest,
  overlaysInput: unknown
): { ok: true; overlays: ArchitectureOverlays } | { ok: false; diagnostics: RuntimeDiagnostic[] } {
  try {
    const overlays = validateArchitectureOverlays(overlaysInput);
    validateOverlayReferences(manifest, overlays);
    return { ok: true, overlays };
  } catch (error) {
    return { ok: false, diagnostics: diagnosticsFor("overlays", error) };
  }
}
