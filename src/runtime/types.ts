import type { ArchitectureManifest, ArchitectureOverlays } from "../zod";

export type RuntimeFile = "architecture" | "overlays";
export type RuntimeSeverity = "error";
export type OverlayStatusState = "sample" | "file" | "dynamic" | "stale" | "error";

export interface RuntimeDiagnostic {
  file: RuntimeFile;
  severity: RuntimeSeverity;
  message: string;
  path?: string;
}

export interface OverlayRuntimeStatus {
  state: OverlayStatusState;
  message?: string;
}

export interface RuntimeArchitecturePayload {
  manifest: ArchitectureManifest;
  overlays: ArchitectureOverlays;
  architectureRevision: number;
  overlayRevision: number;
  overlayGeneratedAt: string;
  overlaySource: string;
  overlayStatus: OverlayRuntimeStatus;
  editorEnabled: boolean;
  graphControlsVisible: boolean;
  graphControlApplyEnabled: boolean;
  graphControlsPreviewEnabled?: boolean;
}

export interface ArchitectureSourcePayload {
  architectureYaml: string;
  overlaysYaml: string;
}

export interface ArchitectureLintResponse {
  ok: boolean;
  diagnostics: RuntimeDiagnostic[];
  manifest?: ArchitectureManifest;
  overlays?: ArchitectureOverlays;
  status?: number;
}

export type OverlaySnapshotMode = "merge" | "control";

export interface OverlaySnapshotRequest {
  overlays: unknown;
  mode?: OverlaySnapshotMode;
  source?: string;
  generatedAt?: string;
}

export interface OverlayControlValueUpdateRequest {
  controlId: string;
  desiredValue?: unknown;
  priority?: unknown;
  source?: string;
  generatedAt?: string;
}

export interface RuntimeRevisionEvent {
  type: "architecture" | "overlays";
  architectureRevision: number;
  overlayRevision: number;
  overlayGeneratedAt: string;
  overlaySource: string;
  overlayStatus: OverlayRuntimeStatus;
}
