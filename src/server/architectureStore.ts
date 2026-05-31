import { readFile, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "yaml";
import {
  lintArchitectureDocuments,
  validateArchitectureDocuments,
  validateOverlaySnapshot,
  RuntimeValidationError
} from "./runtimeValidation";
import type {
  ArchitectureLintResponse,
  ArchitectureSourcePayload,
  OverlayControlValueUpdateRequest,
  OverlayRuntimeStatus,
  OverlaySnapshotRequest,
  RuntimeArchitecturePayload,
  RuntimeDiagnostic,
  RuntimeRevisionEvent
} from "../runtime/types";
import type { ArchitectureManifest, ArchitectureOverlays, OverlayControl, OverlayControlValue } from "../zod";
import {
  createDefaultControlHandlers,
  type ControlPollResult,
  type OverlayControlHandler
} from "./controlHandlers";

type RuntimeOverlayKind = "sample" | "file" | "dynamic";
type RuntimeListener = (event: RuntimeRevisionEvent) => void;

export interface ArchitectureStoreOptions {
  dataDir?: string;
  sampleDir?: string;
  staleAfterSeconds?: number;
  watchFiles?: boolean;
  graphControlsVisible?: boolean;
  graphControlApplyEnabled?: boolean;
  graphControlsPreviewEnabled?: boolean;
  controlHandlers?: Record<string, OverlayControlHandler>;
  controlPollDelayMs?: number;
}

const DEFAULT_SAMPLE_DIR = resolve(process.cwd(), "data", "sample");

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function normalizeIsoDate(input: string | undefined, fallback = new Date()): string {
  if (!input) {
    return fallback.toISOString();
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

export class ArchitectureStore {
  private readonly dataDir: string;
  private readonly usesSampleData: boolean;
  readonly graphControlsVisible: boolean;
  readonly graphControlApplyEnabled: boolean;
  private readonly staleAfterSeconds?: number;
  private readonly controlHandlers: Record<string, OverlayControlHandler>;
  private readonly controlPollDelayMs: number;
  private readonly controlPollTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly watchers: FSWatcher[] = [];
  private readonly listeners = new Set<RuntimeListener>();

  private architectureYaml = "";
  private overlaysYaml = "";
  private manifest!: ArchitectureManifest;
  private overlays!: ArchitectureOverlays;
  private overlayKind: RuntimeOverlayKind;
  private overlaySource = "sample";
  private overlayGeneratedAt = new Date().toISOString();
  private architectureRevision = 0;
  private overlayRevision = 0;
  private lastRejectedOverlay?: string;
  private watchReloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ArchitectureStoreOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.ARCHITECTURE_DATA_DIR ?? options.sampleDir ?? DEFAULT_SAMPLE_DIR);
    this.usesSampleData = !options.dataDir && !process.env.ARCHITECTURE_DATA_DIR;
    this.graphControlApplyEnabled = options.graphControlApplyEnabled ?? isEnabled(process.env.GRAPH_CONTROL_APPLY_ENABLED);
    this.graphControlsVisible =
      options.graphControlsVisible ??
      options.graphControlsPreviewEnabled ??
      (isEnabled(process.env.GRAPH_CONTROLS_VISIBLE) ||
        isEnabled(process.env.GRAPH_CONTROLS_PREVIEW) ||
        this.graphControlApplyEnabled);
    this.controlHandlers = options.controlHandlers ?? createDefaultControlHandlers();
    this.controlPollDelayMs = options.controlPollDelayMs ?? 750;
    this.overlayKind = this.usesSampleData ? "sample" : "file";
    this.overlaySource = this.usesSampleData ? "sample" : "file";
    const configuredStaleAfter = options.staleAfterSeconds ?? Number(process.env.OVERLAY_STALE_AFTER_SECONDS || 0);
    this.staleAfterSeconds = configuredStaleAfter > 0 ? configuredStaleAfter : undefined;
  }

  get editorEnabled(): boolean {
    return true;
  }

  async initialize(): Promise<void> {
    await this.reloadFromDisk();
  }

  startWatching(): void {
    if (this.watchers.length > 0) {
      return;
    }

    for (const fileName of ["architecture.yaml", "architecture-overlays.yaml"]) {
      const watcher = watch(resolve(this.dataDir, fileName), () => {
        if (this.watchReloadTimer) {
          clearTimeout(this.watchReloadTimer);
        }
        this.watchReloadTimer = setTimeout(() => {
          void this.reloadFromDisk().catch((error) => {
            this.lastRejectedOverlay = error instanceof Error ? error.message : "Failed to reload architecture files";
            this.emit("overlays");
          });
        }, 100);
      });
      this.watchers.push(watcher);
    }
  }

  close(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.length = 0;
    if (this.watchReloadTimer) {
      clearTimeout(this.watchReloadTimer);
    }
    for (const timer of this.controlPollTimers) {
      clearTimeout(timer);
    }
    this.controlPollTimers.clear();
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPayload(): RuntimeArchitecturePayload {
    return {
      manifest: this.manifest,
      overlays: this.overlays,
      architectureRevision: this.architectureRevision,
      overlayRevision: this.overlayRevision,
      overlayGeneratedAt: this.overlayGeneratedAt,
      overlaySource: this.overlaySource,
      overlayStatus: this.getOverlayStatus(),
      editorEnabled: this.editorEnabled,
      graphControlsVisible: this.graphControlsVisible,
      graphControlApplyEnabled: this.graphControlApplyEnabled,
      graphControlsPreviewEnabled: this.graphControlsVisible
    };
  }

  getSource(): ArchitectureSourcePayload {
    return {
      architectureYaml: this.architectureYaml,
      overlaysYaml: this.overlaysYaml
    };
  }

  lintSource(architectureYaml: string, overlaysYaml: string): ArchitectureLintResponse {
    const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
    if (!result.ok) {
      return {
        ok: false,
        diagnostics: result.diagnostics
      };
    }

    return {
      ok: true,
      diagnostics: [],
      manifest: result.manifest,
      overlays: result.overlays
    };
  }

  applyDraft(architectureYaml: string, overlaysYaml: string): ArchitectureLintResponse {
    const lintResult = this.lintSource(architectureYaml, overlaysYaml);
    if (!lintResult.ok || !lintResult.manifest || !lintResult.overlays) {
      return lintResult;
    }

    this.architectureYaml = architectureYaml;
    this.overlaysYaml = overlaysYaml;
    this.manifest = lintResult.manifest;
    this.overlays = lintResult.overlays;
    this.overlayKind = "dynamic";
    this.overlaySource = "editor draft";
    this.overlayGeneratedAt = new Date().toISOString();
    this.architectureRevision += 1;
    this.overlayRevision += 1;
    this.lastRejectedOverlay = undefined;
    this.emit("architecture");

    return lintResult;
  }

  async resetDraft(): Promise<void> {
    await this.reloadFromDisk();
    this.emit("architecture");
  }

  updateOverlaySnapshot(request: OverlaySnapshotRequest): ArchitectureLintResponse {
    const result = validateOverlaySnapshot(this.manifest, request.overlays);
    if (!result.ok) {
      this.lastRejectedOverlay = result.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      return {
        ok: false,
        diagnostics: result.diagnostics
      };
    }

    const overlays = this.mergeOverlaySnapshot(result.overlays, request.source);
    const validation = validateOverlaySnapshot(this.manifest, overlays);
    if (!validation.ok) {
      this.lastRejectedOverlay = validation.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      return {
        ok: false,
        diagnostics: validation.diagnostics
      };
    }

    this.overlays = validation.overlays;
    this.overlaysYaml = stringify(validation.overlays);
    this.overlayKind = "dynamic";
    this.overlaySource = request.source?.trim() || "push";
    this.overlayGeneratedAt = normalizeIsoDate(request.generatedAt);
    this.overlayRevision += 1;
    this.lastRejectedOverlay = undefined;
    this.emit("overlays");

    return {
      ok: true,
      diagnostics: [],
      manifest: this.manifest,
      overlays: this.overlays
    };
  }

  async updateOverlayControlValue(request: OverlayControlValueUpdateRequest): Promise<ArchitectureLintResponse> {
    const result = await this.buildUpdatedControlOverlay(request);
    if (!result.ok) {
      this.lastRejectedOverlay = result.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      return result;
    }

    this.overlays = result.overlays;
    this.overlaysYaml = stringify(result.overlays);
    this.overlayKind = "dynamic";
    this.overlaySource = request.source?.trim() || "control-edit";
    this.overlayGeneratedAt = normalizeIsoDate(request.generatedAt);
    this.overlayRevision += 1;
    this.lastRejectedOverlay = undefined;
    this.emit("overlays");
    this.scheduleControlPoll(request.controlId, result.handlerName, result.operationId);

    return {
      ok: true,
      diagnostics: [],
      manifest: this.manifest,
      overlays: this.overlays
    };
  }

  private async reloadFromDisk(): Promise<void> {
    const architecturePath = resolve(this.dataDir, "architecture.yaml");
    const overlaysPath = resolve(this.dataDir, "architecture-overlays.yaml");
    const [architectureYaml, overlaysYaml, overlaysStat] = await Promise.all([
      readFile(architecturePath, "utf8"),
      readFile(overlaysPath, "utf8"),
      stat(overlaysPath)
    ]);
    const validated = validateArchitectureDocuments(architectureYaml, overlaysYaml);

    this.architectureYaml = architectureYaml;
    this.overlaysYaml = overlaysYaml;
    this.manifest = validated.manifest;
    this.overlays = validated.overlays;
    this.overlayKind = this.usesSampleData ? "sample" : "file";
    this.overlaySource = this.usesSampleData ? "sample" : "file";
    this.overlayGeneratedAt = overlaysStat.mtime.toISOString();
    this.architectureRevision += 1;
    this.overlayRevision += 1;
    this.lastRejectedOverlay = undefined;
  }

  private getOverlayStatus(): OverlayRuntimeStatus {
    if (this.lastRejectedOverlay) {
      return {
        state: "error",
        message: `Last overlay update was rejected: ${this.lastRejectedOverlay}`
      };
    }

    if (this.overlayKind === "dynamic" && this.staleAfterSeconds) {
      const ageMs = Date.now() - new Date(this.overlayGeneratedAt).getTime();
      if (ageMs > this.staleAfterSeconds * 1000) {
        return {
          state: "stale",
          message: `Overlay has not updated for more than ${this.staleAfterSeconds} seconds`
        };
      }
    }

    return {
      state: this.overlayKind
    };
  }

  private async buildUpdatedControlOverlay(
    request: OverlayControlValueUpdateRequest
  ): Promise<
    | { ok: true; overlays: ArchitectureOverlays; handlerName: string; operationId: string }
    | { ok: false; diagnostics: RuntimeDiagnostic[]; status?: number }
  > {
    const requestedDesiredValue = Object.hasOwn(request, "desiredValue");
    const requestedPriority = Object.hasOwn(request, "priority");
    if (!requestedDesiredValue && !requestedPriority) {
      return controlUpdateError("desiredValue or priority is required");
    }

    const control = this.overlays.controls.find((candidate) => candidate.id === request.controlId);
    if (!control) {
      return controlUpdateError(`Control ${request.controlId} does not exist`);
    }
    if (control.state.apply.phase === "applying") {
      return controlUpdateError(`Control ${control.id} already has an apply operation in flight`, 409);
    }

    if (requestedPriority) {
      const priorityDiagnostics = this.validateEditablePriority(control, request.priority);
      if (priorityDiagnostics.length > 0) {
        return { ok: false, diagnostics: priorityDiagnostics };
      }
    }
    const desiredValue = requestedDesiredValue ? request.desiredValue : control.state.desired_value;
    const priority = requestedPriority ? request.priority : control.state.priority;
    if (!isOverlayControlValue(desiredValue)) {
      return controlUpdateError(`Control ${control.id} desired value is invalid`);
    }
    if (priority !== undefined && typeof priority !== "number") {
      return controlUpdateError(`Control ${control.id} priority must be a number`);
    }
    const handlerName = control.apply.handler;
    const handler = this.controlHandlers[handlerName];
    if (!handler) {
      return controlUpdateError(`Control handler ${handlerName} is not registered`);
    }
    const requestedAt = normalizeIsoDate(request.generatedAt);
    const applyResult = await handler.apply({
      control,
      desiredValue,
      priority,
      requestedAt
    });

    const overlays = {
      ...this.overlays,
      controls: this.overlays.controls.map((candidate) =>
        candidate.id === request.controlId
          ? {
              ...candidate,
              state: {
                ...candidate.state,
                ...(requestedDesiredValue ? { desired_value: request.desiredValue } : {}),
                ...(requestedPriority ? { priority: request.priority } : {}),
                apply: {
                  phase: "applying" as const,
                  operation_id: applyResult.operationId,
                  requested_at: requestedAt,
                  message: applyResult.message ?? `Waiting for ${handlerName}`
                }
              }
            }
          : candidate
      )
    };
    const validation = validateOverlaySnapshot(this.manifest, overlays);
    if (!validation.ok) {
      return validation;
    }

    return {
      ok: true,
      overlays: validation.overlays,
      handlerName,
      operationId: applyResult.operationId
    };
  }

  private validateEditablePriority(control: OverlayControl, priority: unknown): RuntimeDiagnostic[] {
    if (!control.spec.priority?.editable) {
      return [
        {
          file: "overlays",
          severity: "error",
          message: `Control ${control.id} priority is not editable`
        }
      ];
    }
    if (typeof priority !== "number") {
      return [
        {
          file: "overlays",
          severity: "error",
          message: `Control ${control.id} priority must be a number`
        }
      ];
    }
    return [];
  }

  private mergeOverlaySnapshot(overlays: ArchitectureOverlays, source: string | undefined): ArchitectureOverlays {
    if (source !== "control-backend") {
      return {
        ...overlays,
        node_decorators: mergeById(this.overlays.node_decorators, overlays.node_decorators),
        edge_decorators: mergeById(this.overlays.edge_decorators, overlays.edge_decorators),
        route_decorators: mergeById(this.overlays.route_decorators, overlays.route_decorators),
        controls: this.overlays.controls
      };
    }
    return {
      ...overlays,
      controls: overlays.controls.map((control) => {
        const current = this.overlays.controls.find((candidate) => candidate.id === control.id);
        if (current?.state.apply.phase === "applying" && control.state.apply.phase !== "applying") {
          return {
            ...control,
            state: {
              ...control.state,
              apply: current.state.apply
            }
          };
        }
        return control;
      })
    };
  }

  private scheduleControlPoll(controlId: string, handlerName: string, operationId: string): void {
    const timer = setTimeout(() => {
      this.controlPollTimers.delete(timer);
      void this.pollControlOperation(controlId, handlerName, operationId);
    }, this.controlPollDelayMs);
    this.controlPollTimers.add(timer);
  }

  private async pollControlOperation(controlId: string, handlerName: string, operationId: string): Promise<void> {
    const handler = this.controlHandlers[handlerName];
    const pollResult = handler
      ? await handler.poll(operationId).catch((error: unknown): ControlPollResult => ({
          phase: "failed",
          observedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : "Control poll failed"
        }))
      : {
          phase: "failed" as const,
          observedAt: new Date().toISOString(),
          message: `Control handler ${handlerName} is not registered`
        };

    const overlays = this.withUpdatedControl(controlId, (control) => {
      if (control.state.apply.operation_id !== operationId) {
        return control;
      }
      return {
        ...control,
        state: {
          ...control.state,
          ...(pollResult.effectiveValue !== undefined ? { effective_value: pollResult.effectiveValue } : {}),
          apply: {
            phase: pollResult.phase,
            operation_id: operationId,
            requested_at: control.state.apply.requested_at,
            observed_at: pollResult.observedAt ?? new Date().toISOString(),
            message: pollResult.message
          }
        }
      };
    });
    const validation = validateOverlaySnapshot(this.manifest, overlays);
    if (!validation.ok) {
      this.lastRejectedOverlay = validation.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      this.emit("overlays");
      return;
    }
    this.overlays = validation.overlays;
    this.overlaysYaml = stringify(validation.overlays);
    this.overlayKind = "dynamic";
    this.overlaySource = "control-observed";
    this.overlayGeneratedAt = new Date().toISOString();
    this.overlayRevision += 1;
    this.lastRejectedOverlay = undefined;
    this.emit("overlays");
  }

  private withUpdatedControl(controlId: string, update: (control: OverlayControl) => OverlayControl): ArchitectureOverlays {
    return {
      ...this.overlays,
      controls: this.overlays.controls.map((control) => (control.id === controlId ? update(control) : control))
    };
  }

  private emit(type: RuntimeRevisionEvent["type"]): void {
    const event = this.getRevisionEvent(type);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private getRevisionEvent(type: RuntimeRevisionEvent["type"]): RuntimeRevisionEvent {
    return {
      type,
      architectureRevision: this.architectureRevision,
      overlayRevision: this.overlayRevision,
      overlayGeneratedAt: this.overlayGeneratedAt,
      overlaySource: this.overlaySource,
      overlayStatus: this.getOverlayStatus()
    };
  }
}

function controlUpdateError(message: string, status?: number): { ok: false; diagnostics: RuntimeDiagnostic[]; status?: number } {
  return {
    ok: false,
    status,
    diagnostics: [
      {
        file: "overlays",
        severity: "error",
        message
      }
    ]
  };
}

function isOverlayControlValue(value: unknown): value is OverlayControlValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const merged = current.map((item) => incomingById.get(item.id) ?? item);
  const currentIds = new Set(current.map((item) => item.id));
  return [...merged, ...incoming.filter((item) => !currentIds.has(item.id))];
}

export async function createArchitectureStore(options: ArchitectureStoreOptions = {}): Promise<ArchitectureStore> {
  const store = new ArchitectureStore(options);
  try {
    await store.initialize();
  } catch (error) {
    if (error instanceof RuntimeValidationError) {
      throw new Error(error.diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n"));
    }
    throw error;
  }
  if (options.watchFiles) {
    store.startWatching();
  }
  return store;
}
