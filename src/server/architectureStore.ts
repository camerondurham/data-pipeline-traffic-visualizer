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
  OverlayRuntimeStatus,
  OverlaySnapshotRequest,
  RuntimeArchitecturePayload,
  RuntimeRevisionEvent
} from "../runtime/types";
import type { ArchitectureManifest, ArchitectureOverlays } from "../zod";

type RuntimeOverlayKind = "sample" | "file" | "dynamic";
type RuntimeListener = (event: RuntimeRevisionEvent) => void;

export interface ArchitectureStoreOptions {
  dataDir?: string;
  sampleDir?: string;
  staleAfterSeconds?: number;
  watchFiles?: boolean;
}

const DEFAULT_SAMPLE_DIR = resolve(process.cwd(), "data", "sample");

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
  private readonly staleAfterSeconds?: number;
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
      editorEnabled: this.editorEnabled
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

    this.overlays = result.overlays;
    this.overlaysYaml = stringify(result.overlays);
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
