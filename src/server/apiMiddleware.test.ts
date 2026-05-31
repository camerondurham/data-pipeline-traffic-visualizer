import { createServer, get, request as httpRequest, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { buildSampleLiveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE } from "../sampleLiveTps";
import { createArchitectureStore, type ArchitectureStore } from "./architectureStore";
import { createArchitectureApiMiddleware } from "./apiMiddleware";
import type { RuntimeArchitecturePayload } from "../runtime/types";
import type { ArchitectureOverlays } from "../zod";

interface TestApi {
  baseUrl: string;
  store: ArchitectureStore;
  close: () => Promise<void>;
}

async function startApi(
  options: { graphControlsVisible?: boolean; graphControlApplyEnabled?: boolean; graphControlsPreviewEnabled?: boolean } = {}
): Promise<TestApi> {
  const store = await createArchitectureStore(options);
  const middleware = createArchitectureApiMiddleware(store);
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void middleware(request, response);
  });
  server.on("connection", (socket) => {
    socket.unref();
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    store,
    close: () => closeServer(server, store, sockets)
  };
}

function closeServer(server: Server, store: ArchitectureStore, sockets: Set<Socket>): Promise<void> {
  store.close();
  for (const socket of sockets) {
    socket.destroy();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

async function readArchitecture(baseUrl: string): Promise<RuntimeArchitecturePayload> {
  const response = await requestJson(baseUrl, "/api/architecture");
  expect(response.status).toBe(200);
  return response.json as RuntimeArchitecturePayload;
}

function liveOverlay(value = "99"): ArchitectureOverlays {
  return {
    node_decorators: [
      {
        id: "live-hot-products-lag",
        node_id: "use1.hot.cluster.products",
        title: "Live hot products lag",
        metrics: [{ label: "lag", value }],
        badges: [],
        notes: []
      }
    ],
    edge_decorators: [
      {
        id: "live-hot-index-throughput",
        edge_id: "edge.use1.hot.indexers.to.products.cluster",
        metric_label: `${value} msg/s`,
        badges: ["live"],
        metrics: []
      }
    ],
    route_decorators: [],
    controls: []
  };
}

async function postOverlay(baseUrl: string, overlays: ArchitectureOverlays, source = "test-updater") {
  return requestJson(baseUrl, "/api/overlays/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { overlays, source, generatedAt: "2026-05-25T12:00:00.000Z" }
  });
}

async function postControlValue(
  baseUrl: string,
  body: { controlId: string; desiredValue?: unknown; priority?: unknown; source?: string } = {
    controlId: "partner-token-aggregate-throttle",
    desiredValue: 750,
    priority: 30,
    source: "graph-control"
  }
) {
  return requestJson(baseUrl, "/api/overlays/control-value", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
}

async function waitForControlPhase(baseUrl: string, controlId: string, phase: string): Promise<RuntimeArchitecturePayload> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const payload = await readArchitecture(baseUrl);
    const control = payload.overlays.controls.find((candidate) => candidate.id === controlId);
    if (control?.state.apply.phase === phase) {
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${controlId} phase ${phase}`);
}

function requestJson(
  baseUrl: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; text: string; json: unknown }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const url = new URL(path, baseUrl);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        agent: false,
        headers: {
          Connection: "close",
          ...(options.headers ?? {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {})
        }
      },
      (response) => {
        response.setEncoding("utf8");
        let text = "";
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            text,
            json: text ? JSON.parse(text) : undefined
          });
        });
      }
    );
    request.on("socket", (socket) => socket.unref());
    request.on("error", rejectRequest);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function requestRawJson(baseUrl: string, path: string, body: string): Promise<{ status: number; text: string; json: unknown }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(
      new URL(path, baseUrl),
      {
        method: "POST",
        agent: false,
        headers: {
          Connection: "close",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body).toString()
        }
      },
      (response) => {
        response.setEncoding("utf8");
        let text = "";
        response.on("data", (chunk: string) => {
          text += chunk;
        });
        response.on("end", () => {
          resolveRequest({
            status: response.statusCode ?? 0,
            text,
            json: text ? JSON.parse(text) : undefined
          });
        });
      }
    );
    request.on("socket", (socket) => socket.unref());
    request.on("error", rejectRequest);
    request.write(body);
    request.end();
  });
}

function waitForSsePattern(url: string, pattern: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    let settled = false;
    let matchedText: string | undefined;
    const request = get(url, { agent: false, headers: { Connection: "close" } }, (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        text += chunk;
        if (text.includes(pattern)) {
          settled = true;
          matchedText = text;
          request.destroy();
        }
      });
    });
    request.on("socket", (socket) => socket.unref());
    const timeout = setTimeout(() => {
      settled = true;
      request.destroy();
      reject(new Error(`Timed out waiting for SSE pattern: ${pattern}`));
    }, 3000);
    request.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    request.on("close", () => {
      clearTimeout(timeout);
      if (matchedText) {
        resolve(matchedText);
      }
    });
  });
}

describe("architecture runtime API", () => {
  it("serves the representative sample architecture and overlays by default", async () => {
    const api = await startApi();
    try {
      const payload = await readArchitecture(api.baseUrl);

      expect(payload.manifest.nodes.length).toBeGreaterThan(10);
      expect(payload.manifest.edges.length).toBeGreaterThan(10);
      expect(payload.manifest.views.length).toBeGreaterThan(0);
      expect(payload.overlays.node_decorators.length).toBeGreaterThan(0);
      expect(payload.overlays.edge_decorators.length).toBeGreaterThan(0);
      expect(payload.overlays.route_decorators.length).toBeGreaterThan(0);
      expect(payload.overlayStatus.state).toBe("sample");
      expect(payload.graphControlsVisible).toBe(false);
      expect(payload.graphControlApplyEnabled).toBe(false);
    } finally {
      await api.close();
    }
  });

  it("serves editable runtime source without credentials", async () => {
    const api = await startApi();
    try {
      const response = await requestJson(api.baseUrl, "/api/architecture/source");
      expect(response.status).toBe(200);
      expect((response.json as { architectureYaml: string }).architectureYaml).toContain("nodes:");
    } finally {
      await api.close();
    }
  });

  it("returns 400 for malformed JSON request bodies", async () => {
    const api = await startApi();
    try {
      const response = await requestRawJson(api.baseUrl, "/api/architecture/lint", "{not-json");

      expect(response.status).toBe(400);
      expect(response.json).toEqual({ error: "Malformed JSON request body" });
    } finally {
      await api.close();
    }
  });

  it("accepts a valid telemetry overlay snapshot and merges it with static control context", async () => {
    const api = await startApi();
    try {
      expect((await postOverlay(api.baseUrl, liveOverlay("42"))).status).toBe(200);

      const payload = await readArchitecture(api.baseUrl);
      expect(payload.overlaySource).toBe("test-updater");
      expect(payload.overlayStatus.state).toBe("dynamic");
      expect(payload.overlayGeneratedAt).toBe("2026-05-25T12:00:00.000Z");
      expect(payload.overlays.node_decorators.find((decorator) => decorator.id === "live-hot-products-lag")?.metrics[0]).toEqual({
        label: "lag",
        value: "42"
      });
    } finally {
      await api.close();
    }
  });

  it("rejects invalid overlay snapshots and preserves the previous active overlay", async () => {
    const api = await startApi();
    try {
      expect((await postOverlay(api.baseUrl, liveOverlay("77"))).status).toBe(200);

      const invalid: ArchitectureOverlays = {
        node_decorators: [{ id: "bad-node", node_id: "missing-node", metrics: [], badges: [], notes: [] }],
        edge_decorators: [],
        route_decorators: [],
        controls: []
      };
      expect((await postOverlay(api.baseUrl, invalid)).status).toBe(422);

      const payload = await readArchitecture(api.baseUrl);
      const liveDecorator = payload.overlays.node_decorators.find((decorator) => decorator.id === "live-hot-products-lag");
      expect(liveDecorator?.metrics[0]?.value).toBe("77");
      expect(payload.overlayStatus.state).toBe("error");
      expect(payload.overlayStatus.message).toContain("missing node");
    } finally {
      await api.close();
    }
  });

  it("starts an async control apply and later observes the simulated generated config", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      const seed = await readArchitecture(api.baseUrl);
      const seedControl = seed.overlays.controls.find((control) => control.id === "partner-token-aggregate-throttle");
      expect(seedControl?.state.desired_value).toBe(500);
      expect(seedControl?.state.priority).toBe(20);

      const response = await postControlValue(api.baseUrl);
      expect(response.status).toBe(200);

      const payload = await readArchitecture(api.baseUrl);
      const control = payload.overlays.controls.find((candidate) => candidate.id === "partner-token-aggregate-throttle");
      expect(payload.overlayRevision).toBe(seed.overlayRevision + 1);
      expect(payload.overlaySource).toBe("graph-control");
      expect(payload.overlayStatus.state).toBe("dynamic");
      expect(control?.state.desired_value).toBe(750);
      expect(control?.state.effective_value).toBe(500);
      expect(control?.state.priority).toBe(30);
      expect(control?.state.apply.phase).toBe("applying");
      expect(control?.state.apply.operation_id).toMatch(/^sim-throttle-/);
      expect(control?.state.apply.requested_at).toBeTruthy();

      const observedPayload = await waitForControlPhase(api.baseUrl, "partner-token-aggregate-throttle", "applied");
      const observedControl = observedPayload.overlays.controls.find((candidate) => candidate.id === "partner-token-aggregate-throttle");
      expect(observedPayload.overlayRevision).toBe(seed.overlayRevision + 2);
      expect(observedPayload.overlaySource).toBe("control-observed");
      expect(observedControl?.state.effective_value).toBe(750);
      expect(observedControl?.state.apply.observed_at).toBeTruthy();
    } finally {
      await api.close();
    }
  });

  it("rejects control applies when controls are visible but apply is disabled", async () => {
    const api = await startApi({ graphControlsVisible: true });
    try {
      const seed = await readArchitecture(api.baseUrl);
      const response = await postControlValue(api.baseUrl);

      expect(response.status).toBe(403);
      expect(response.json).toEqual({ error: "Graph control apply is disabled" });

      const payload = await readArchitecture(api.baseUrl);
      const control = payload.overlays.controls.find((candidate) => candidate.id === "partner-token-aggregate-throttle");
      expect(payload.overlayRevision).toBe(seed.overlayRevision);
      expect(control?.state.desired_value).toBe(500);
    } finally {
      await api.close();
    }
  });

  it("rejects invalid control edits and preserves the previous active overlay", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      expect((await postControlValue(api.baseUrl, { controlId: "partner-token-aggregate-throttle", desiredValue: 700 })).status).toBe(200);
      await waitForControlPhase(api.baseUrl, "partner-token-aggregate-throttle", "applied");

      const response = await postControlValue(api.baseUrl, {
        controlId: "partner-token-aggregate-throttle",
        desiredValue: 2050
      });
      expect(response.status).toBe(422);

      const payload = await readArchitecture(api.baseUrl);
      const control = payload.overlays.controls.find((candidate) => candidate.id === "partner-token-aggregate-throttle");
      expect(control?.state.desired_value).toBe(700);
      expect(payload.overlayStatus.state).toBe("error");
      expect(payload.overlayStatus.message).toContain("less than or equal to 2000");
    } finally {
      await api.close();
    }
  });

  it("rejects missing controls and non-editable priority updates", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      const missing = await postControlValue(api.baseUrl, { controlId: "missing-control", desiredValue: 800 });
      expect(missing.status).toBe(422);
      expect(missing.text).toContain("does not exist");

      const seed = await readArchitecture(api.baseUrl);
      const readonlyPriorityOverlay: ArchitectureOverlays = {
        ...seed.overlays,
        controls: [
          {
            ...seed.overlays.controls[0],
            id: "readonly-priority",
            spec: {
              ...seed.overlays.controls[0].spec,
              priority: { editable: false, min: 0, max: 100 }
            }
          }
        ]
      };
      expect((await postOverlay(api.baseUrl, readonlyPriorityOverlay, "control-backend")).status).toBe(200);

      const readonlyPriority = await postControlValue(api.baseUrl, {
        controlId: "readonly-priority",
        priority: 40
      });
      expect(readonlyPriority.status).toBe(422);
      expect(readonlyPriority.text).toContain("priority is not editable");
    } finally {
      await api.close();
    }
  });

  it("rejects concurrent apply attempts for the same control", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      expect((await postControlValue(api.baseUrl, { controlId: "partner-token-aggregate-throttle", desiredValue: 800 })).status).toBe(200);
      const response = await postControlValue(api.baseUrl, { controlId: "partner-token-aggregate-throttle", desiredValue: 850 });

      expect(response.status).toBe(409);
      expect(response.text).toContain("already has an apply operation in flight");
    } finally {
      await api.close();
    }
  });

  it("rejects controls that reference an unknown apply handler", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      const seed = await readArchitecture(api.baseUrl);
      const unknownHandlerOverlay: ArchitectureOverlays = {
        ...seed.overlays,
        controls: [
          {
            ...seed.overlays.controls[0],
            id: "unknown-handler-control",
            apply: { handler: "missing-handler" }
          }
        ]
      };
      expect((await postOverlay(api.baseUrl, unknownHandlerOverlay, "control-backend")).status).toBe(200);

      const response = await postControlValue(api.baseUrl, {
        controlId: "unknown-handler-control",
        desiredValue: 800
      });
      expect(response.status).toBe(422);
      expect(response.text).toContain("missing-handler");
    } finally {
      await api.close();
    }
  });

  it("broadcasts an SSE revision event after a valid overlay update", async () => {
      const api = await startApi();
    try {
      const eventText = waitForSsePattern(`${api.baseUrl}/api/architecture/events`, "sse-test");
      expect((await postOverlay(api.baseUrl, liveOverlay("13"), "sse-test")).status).toBe(200);

      await expect(eventText).resolves.toContain('"overlaySource":"sse-test"');
    } finally {
      await api.close();
    }
  });

  it("broadcasts an SSE revision event after a valid control update", async () => {
    const api = await startApi({ graphControlsVisible: true, graphControlApplyEnabled: true });
    try {
      const eventText = waitForSsePattern(`${api.baseUrl}/api/architecture/events`, "graph-control");
      expect((await postControlValue(api.baseUrl)).status).toBe(200);

      await expect(eventText).resolves.toContain('"overlaySource":"graph-control"');
    } finally {
      await api.close();
    }
  });

  it("accepts generated sample live TPS snapshots and broadcasts the revision", async () => {
    const api = await startApi();
    try {
      const seedPayload = await readArchitecture(api.baseUrl);
      const eventText = waitForSsePattern(`${api.baseUrl}/api/architecture/events`, SAMPLE_LIVE_TPS_SOURCE);
      const liveTpsOverlays = buildSampleLiveTpsOverlays(seedPayload.overlays, { tick: 2 });

      expect((await postOverlay(api.baseUrl, liveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE)).status).toBe(200);

      const payload = await readArchitecture(api.baseUrl);
      expect(payload.overlaySource).toBe(SAMPLE_LIVE_TPS_SOURCE);
      expect(payload.overlayStatus.state).toBe("dynamic");
      expect(payload.overlays.node_decorators).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "live-tps-orders-ingestion-stream",
            node_id: "use1.ingestion.orders_stream",
            metrics: [expect.objectContaining({ label: "TPS" })]
          })
        ])
      );
      expect(payload.overlays.edge_decorators).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "live-tps-edge-web-orders-ingestion",
            edge_id: "edge.use1.sources.web.to.orders.ingestion",
            metric_label: expect.stringMatching(/ TPS$/)
          })
        ])
      );
      expect(payload.overlays.controls).toEqual(seedPayload.overlays.controls);
      await expect(eventText).resolves.toContain(`"overlaySource":"${SAMPLE_LIVE_TPS_SOURCE}"`);
    } finally {
      await api.close();
    }
  });
});
