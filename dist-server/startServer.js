import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname, normalize } from "node:path";
import { watch } from "node:fs";
import { parse, stringify } from "yaml";
import { z, ZodError } from "zod";
const DEFAULT_FLOW_LANES = [
  { id: "cold", label: "Cold branch" },
  { id: "normal", label: "Pre-aggregate and aggregate" },
  { id: "hot", label: "Hot branch" },
  { id: "slow_lane", label: "Slow-lane replay" },
  { id: "partner", label: "Partner routes" }
];
function assertUniqueIds(items, label) {
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}
function assertSubset(subset, superset, label, viewId) {
  for (const id of subset) {
    if (!superset.has(id)) {
      throw new Error(`${viewId}.${label} references an edge outside focus_edges: ${id}`);
    }
  }
}
function assertAcyclicParents(nodesById) {
  for (const node of nodesById.values()) {
    const seen = /* @__PURE__ */ new Set([node.id]);
    let parentId = node.parent;
    while (parentId) {
      if (seen.has(parentId)) {
        throw new Error(`Parent cycle detected at node ${node.id}: ${[...seen, parentId].join(" -> ")}`);
      }
      seen.add(parentId);
      parentId = nodesById.get(parentId)?.parent;
    }
  }
}
function validateGraphReferences(manifest) {
  assertUniqueIds(manifest.nodes, "node");
  assertUniqueIds(manifest.edges, "edge");
  assertUniqueIds(manifest.views, "view");
  const nodesById = new Map(manifest.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const edgeIds = new Set(manifest.edges.map((edge) => edge.id));
  for (const node of manifest.nodes) {
    if (node.parent && !nodeIds.has(node.parent)) {
      throw new Error(`Node ${node.id} references missing parent: ${node.parent}`);
    }
  }
  assertAcyclicParents(nodesById);
  for (const edge of manifest.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Edge ${edge.id} references missing source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Edge ${edge.id} references missing target node: ${edge.to}`);
    }
  }
  for (const view of manifest.views) {
    if (view.mode === "region") {
      const laneIds = new Set((view.lanes ?? DEFAULT_FLOW_LANES).map((lane) => lane.id));
      assertUniqueIds(view.stages ?? [], `${view.id} stage`);
      assertUniqueIds(view.lanes ?? [], `${view.id} lane`);
      for (const stage of view.stages ?? []) {
        if (!laneIds.has(stage.lane)) {
          throw new Error(`View ${view.id} stage ${stage.id} references missing lane: ${stage.lane}`);
        }
        for (const nodeId of stage.node_ids) {
          if (!nodeIds.has(nodeId)) {
            throw new Error(`View ${view.id} stage ${stage.id} references missing node: ${nodeId}`);
          }
        }
      }
    }
    if (view.mode !== "focus") {
      continue;
    }
    for (const edgeId of view.focus_edges) {
      if (!edgeIds.has(edgeId)) {
        throw new Error(`View ${view.id} references missing focus edge: ${edgeId}`);
      }
    }
    const focusEdges = new Set(view.focus_edges);
    assertSubset(view.primary_edges, focusEdges, "primary_edges", view.id);
    assertSubset(view.secondary_edges, focusEdges, "secondary_edges", view.id);
  }
}
function assertUniqueDecoratorIds(overlays) {
  const seen = /* @__PURE__ */ new Set();
  const allDecorators = [
    ...overlays.node_decorators,
    ...overlays.edge_decorators,
    ...overlays.route_decorators
  ];
  for (const decorator of allDecorators) {
    if (seen.has(decorator.id)) {
      throw new Error(`Duplicate overlay decorator id: ${decorator.id}`);
    }
    seen.add(decorator.id);
  }
}
function validateOverlayReferences(manifest, overlays) {
  assertUniqueDecoratorIds(overlays);
  const nodeIds = new Set(manifest.nodes.map((node) => node.id));
  const edgeById = new Map(manifest.edges.map((edge) => [edge.id, edge]));
  for (const decorator of overlays.node_decorators) {
    if (!nodeIds.has(decorator.node_id)) {
      throw new Error(`Node decorator ${decorator.id} references missing node: ${decorator.node_id}`);
    }
  }
  for (const decorator of overlays.edge_decorators) {
    if (!edgeById.has(decorator.edge_id)) {
      throw new Error(`Edge decorator ${decorator.id} references missing edge: ${decorator.edge_id}`);
    }
  }
  for (const decorator of overlays.route_decorators) {
    if (!nodeIds.has(decorator.source_node_id)) {
      throw new Error(`Route decorator ${decorator.id} references missing source node: ${decorator.source_node_id}`);
    }
    let expectedFrom = decorator.source_node_id;
    for (const edgeId of decorator.edge_ids) {
      const edge = edgeById.get(edgeId);
      if (!edge) {
        throw new Error(`Route decorator ${decorator.id} references missing edge: ${edgeId}`);
      }
      if (edge.from !== expectedFrom) {
        throw new Error(
          `Route decorator ${decorator.id} has non-contiguous route at ${edgeId}: expected source ${expectedFrom}, got ${edge.from}`
        );
      }
      expectedFrom = edge.to;
    }
  }
}
const RequiredString = z.string().min(1);
const OverlayToneSchema = z.enum(["default", "primary", "secondary", "cross", "read"]);
const OverlayMetricValueSchema = z.union([z.string().min(1), z.number()]);
const ArchitectureZoneSchema = z.enum(["pre_aggregate", "aggregate", "hot", "cold", "partner"]);
const ArchitectureNodeSchema = z.object({
  id: RequiredString,
  label: RequiredString,
  type: RequiredString,
  region: RequiredString,
  zone: ArchitectureZoneSchema,
  parent: RequiredString.optional(),
  collapsed: z.boolean().optional()
}).strict();
const ArchitectureEdgeSchema = z.object({
  id: RequiredString,
  from: RequiredString,
  to: RequiredString,
  type: RequiredString,
  label: RequiredString.optional()
}).strict();
const FlowLaneSchema = z.object({
  id: RequiredString,
  label: RequiredString
}).strict();
const FlowStageSchema = z.object({
  id: RequiredString,
  label: RequiredString,
  lane: RequiredString,
  node_ids: z.array(RequiredString).min(1)
}).strict();
const RegionViewSchema = z.object({
  id: RequiredString,
  label: RequiredString,
  mode: z.literal("region"),
  region: RequiredString,
  lanes: z.array(FlowLaneSchema).optional(),
  stages: z.array(FlowStageSchema).optional()
}).strict();
const CrossRegionViewSchema = z.object({
  id: RequiredString,
  label: RequiredString,
  mode: z.literal("cross_region"),
  group_by: z.literal("destination_region")
}).strict();
const FocusViewSchema = z.object({
  id: RequiredString,
  label: RequiredString,
  mode: z.literal("focus"),
  focus_edges: z.array(RequiredString).min(1),
  primary_edges: z.array(RequiredString).min(1),
  secondary_edges: z.array(RequiredString).default([])
}).strict();
const ArchitectureViewSchema = z.discriminatedUnion("mode", [
  RegionViewSchema,
  CrossRegionViewSchema,
  FocusViewSchema
]);
const ArchitectureManifestSchema = z.object({
  nodes: z.array(ArchitectureNodeSchema).min(1),
  edges: z.array(ArchitectureEdgeSchema).min(1),
  views: z.array(ArchitectureViewSchema).min(1)
}).strict();
const OverlayMetricSchema = z.object({
  label: RequiredString,
  value: OverlayMetricValueSchema
}).strict();
const NodeDecoratorSchema = z.object({
  id: RequiredString,
  node_id: RequiredString,
  title: RequiredString.optional(),
  metrics: z.array(OverlayMetricSchema).default([]),
  badges: z.array(RequiredString).default([]),
  notes: z.array(RequiredString).default([])
}).strict();
const EdgeDecoratorSchema = z.object({
  id: RequiredString,
  edge_id: RequiredString,
  title: RequiredString.optional(),
  metric_label: RequiredString.optional(),
  badges: z.array(RequiredString).default([]),
  metrics: z.array(OverlayMetricSchema).default([]),
  warning: z.boolean().optional(),
  tone: OverlayToneSchema.optional(),
  thickness: z.number().positive().optional()
}).strict();
const RouteDecoratorSchema = z.object({
  id: RequiredString,
  source_node_id: RequiredString,
  title: RequiredString.optional(),
  edge_ids: z.array(RequiredString).min(1),
  metric_label: RequiredString.optional(),
  badges: z.array(RequiredString).default([]),
  metrics: z.array(OverlayMetricSchema).default([]),
  warning: z.boolean().optional(),
  tone: OverlayToneSchema.optional(),
  thickness: z.number().positive().optional()
}).strict();
const ArchitectureOverlaysSchema = z.object({
  node_decorators: z.array(NodeDecoratorSchema).default([]),
  edge_decorators: z.array(EdgeDecoratorSchema).default([]),
  route_decorators: z.array(RouteDecoratorSchema).default([])
}).strict();
function validateArchitectureManifest(input) {
  return ArchitectureManifestSchema.parse(input);
}
function validateArchitectureOverlays(input) {
  return ArchitectureOverlaysSchema.parse(input ?? {});
}
class RuntimeValidationError extends Error {
  diagnostics;
  constructor(message, diagnostics) {
    super(message);
    this.name = "RuntimeValidationError";
    this.diagnostics = diagnostics;
  }
}
function diagnosticsFor(file, error) {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => ({
      file,
      severity: "error",
      path: issue.path.length ? issue.path.join(".") : void 0,
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
function parseArchitectureYaml(architectureYaml) {
  const manifest = validateArchitectureManifest(parse(architectureYaml));
  validateGraphReferences(manifest);
  return manifest;
}
function parseOverlayYaml(overlaysYaml) {
  return validateArchitectureOverlays(parse(overlaysYaml));
}
function lintArchitectureDocuments(architectureYaml, overlaysYaml) {
  const diagnostics = [];
  let manifest;
  let overlays;
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
function validateArchitectureDocuments(architectureYaml, overlaysYaml) {
  const result = lintArchitectureDocuments(architectureYaml, overlaysYaml);
  if (!result.ok) {
    throw new RuntimeValidationError("Architecture documents failed validation", result.diagnostics);
  }
  return {
    manifest: result.manifest,
    overlays: result.overlays
  };
}
function validateOverlaySnapshot(manifest, overlaysInput) {
  try {
    const overlays = validateArchitectureOverlays(overlaysInput);
    validateOverlayReferences(manifest, overlays);
    return { ok: true, overlays };
  } catch (error) {
    return { ok: false, diagnostics: diagnosticsFor("overlays", error) };
  }
}
const DEFAULT_SAMPLE_DIR = resolve(process.cwd(), "data", "sample");
function normalizeIsoDate(input, fallback = /* @__PURE__ */ new Date()) {
  if (!input) {
    return fallback.toISOString();
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}
class ArchitectureStore {
  dataDir;
  usesSampleData;
  staleAfterSeconds;
  watchers = [];
  listeners = /* @__PURE__ */ new Set();
  architectureYaml = "";
  overlaysYaml = "";
  manifest;
  overlays;
  overlayKind;
  overlaySource = "sample";
  overlayGeneratedAt = (/* @__PURE__ */ new Date()).toISOString();
  architectureRevision = 0;
  overlayRevision = 0;
  lastRejectedOverlay;
  watchReloadTimer;
  constructor(options = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.ARCHITECTURE_DATA_DIR ?? options.sampleDir ?? DEFAULT_SAMPLE_DIR);
    this.usesSampleData = !options.dataDir && !process.env.ARCHITECTURE_DATA_DIR;
    this.overlayKind = this.usesSampleData ? "sample" : "file";
    this.overlaySource = this.usesSampleData ? "sample" : "file";
    const configuredStaleAfter = options.staleAfterSeconds ?? Number(process.env.OVERLAY_STALE_AFTER_SECONDS || 0);
    this.staleAfterSeconds = configuredStaleAfter > 0 ? configuredStaleAfter : void 0;
  }
  get editorEnabled() {
    return true;
  }
  async initialize() {
    await this.reloadFromDisk();
  }
  startWatching() {
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
  close() {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.length = 0;
    if (this.watchReloadTimer) {
      clearTimeout(this.watchReloadTimer);
    }
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getPayload() {
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
  getSource() {
    return {
      architectureYaml: this.architectureYaml,
      overlaysYaml: this.overlaysYaml
    };
  }
  lintSource(architectureYaml, overlaysYaml) {
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
  applyDraft(architectureYaml, overlaysYaml) {
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
    this.overlayGeneratedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.architectureRevision += 1;
    this.overlayRevision += 1;
    this.lastRejectedOverlay = void 0;
    this.emit("architecture");
    return lintResult;
  }
  async resetDraft() {
    await this.reloadFromDisk();
    this.emit("architecture");
  }
  updateOverlaySnapshot(request) {
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
    this.lastRejectedOverlay = void 0;
    this.emit("overlays");
    return {
      ok: true,
      diagnostics: [],
      manifest: this.manifest,
      overlays: this.overlays
    };
  }
  async reloadFromDisk() {
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
    this.lastRejectedOverlay = void 0;
  }
  getOverlayStatus() {
    if (this.lastRejectedOverlay) {
      return {
        state: "error",
        message: `Last overlay update was rejected: ${this.lastRejectedOverlay}`
      };
    }
    if (this.overlayKind === "dynamic" && this.staleAfterSeconds) {
      const ageMs = Date.now() - new Date(this.overlayGeneratedAt).getTime();
      if (ageMs > this.staleAfterSeconds * 1e3) {
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
  emit(type) {
    const event = this.getRevisionEvent(type);
    for (const listener of this.listeners) {
      listener(event);
    }
  }
  getRevisionEvent(type) {
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
async function createArchitectureStore(options = {}) {
  const store2 = new ArchitectureStore(options);
  try {
    await store2.initialize();
  } catch (error) {
    if (error instanceof RuntimeValidationError) {
      throw new Error(error.diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n"));
    }
    throw error;
  }
  if (options.watchFiles) {
    store2.startWatching();
  }
  return store2;
}
const MAX_BODY_BYTES = 2 * 1024 * 1024;
class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "BadRequestError";
  }
}
function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}
function sendEmpty(response, status) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}
function readBody(request) {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        rejectRead(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveRead(body));
    request.on("error", rejectRead);
  });
}
async function readJson(request) {
  const body = await readBody(request);
  if (!body.trim()) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new BadRequestError("Malformed JSON request body");
  }
}
function sendSseEvent(response, eventName, data) {
  response.write(`event: ${eventName}
`);
  response.write(`data: ${JSON.stringify(data)}

`);
}
function createArchitectureApiMiddleware(store2) {
  return async function architectureApiMiddleware(request, response, next) {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";
    try {
      if (method === "GET" && url.pathname === "/api/architecture") {
        sendJson(response, 200, store2.getPayload());
        return;
      }
      if (method === "GET" && url.pathname === "/api/architecture/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        sendSseEvent(response, "revision", store2.getPayload());
        const unsubscribe = store2.subscribe((event) => sendSseEvent(response, "revision", event));
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25e3);
        let closed = false;
        const cleanup = () => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
        };
        request.on("close", cleanup);
        response.on("close", cleanup);
        return;
      }
      if (method === "GET" && url.pathname === "/api/architecture/source") {
        sendJson(response, 200, store2.getSource());
        return;
      }
      if (method === "POST" && url.pathname === "/api/architecture/lint") {
        const body = await readJson(request);
        if (typeof body.architectureYaml !== "string" || typeof body.overlaysYaml !== "string") {
          sendJson(response, 400, { error: "architectureYaml and overlaysYaml are required strings" });
          return;
        }
        sendJson(response, 200, store2.lintSource(body.architectureYaml, body.overlaysYaml));
        return;
      }
      if (method === "POST" && url.pathname === "/api/architecture/draft") {
        const body = await readJson(request);
        if (typeof body.architectureYaml !== "string" || typeof body.overlaysYaml !== "string") {
          sendJson(response, 400, { error: "architectureYaml and overlaysYaml are required strings" });
          return;
        }
        const result = store2.applyDraft(body.architectureYaml, body.overlaysYaml);
        sendJson(response, result.ok ? 200 : 422, result);
        return;
      }
      if (method === "DELETE" && url.pathname === "/api/architecture/draft") {
        await store2.resetDraft();
        sendEmpty(response, 204);
        return;
      }
      if (method === "POST" && url.pathname === "/api/overlays/snapshot") {
        const body = await readJson(request);
        const result = store2.updateOverlaySnapshot({
          overlays: body.overlays,
          source: typeof body.source === "string" ? body.source : void 0,
          generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : void 0
        });
        sendJson(response, result.ok ? 200 : 422, result);
        return;
      }
      if (url.pathname.startsWith("/api/architecture") || url.pathname.startsWith("/api/overlays")) {
        sendJson(response, 404, { error: "Unknown architecture runtime endpoint" });
        return;
      }
      next?.();
    } catch (error) {
      if (error instanceof BadRequestError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Unknown architecture runtime error" });
    }
  };
}
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const distDir = resolve(process.cwd(), "dist");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};
function sendText(response, status, message) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(message);
}
function safeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0] ?? "/");
  const normalizedPath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^[/\\]/, "");
  return resolve(join(distDir, relativePath));
}
async function serveStatic(pathname, response) {
  const candidate = safeStaticPath(pathname);
  const staticPath = candidate.startsWith(distDir) ? candidate : join(distDir, "index.html");
  let filePath = staticPath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    const body = await readFile(join(distDir, "index.html"));
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(body);
  }
}
const store = await createArchitectureStore({
  watchFiles: process.env.ARCHITECTURE_WATCH === "1"
});
const apiMiddleware = createArchitectureApiMiddleware(store);
const server = createServer((request, response) => {
  void apiMiddleware(request, response, () => {
    void serveStatic(request.url ?? "/", response).catch((error) => {
      sendText(
        response,
        error instanceof URIError ? 400 : 500,
        error instanceof URIError ? "Malformed request path" : "Unable to serve request"
      );
    });
  });
});
server.listen(port, host, () => {
  console.log(`Architecture visualizer listening on http://${host}:${port}`);
});
