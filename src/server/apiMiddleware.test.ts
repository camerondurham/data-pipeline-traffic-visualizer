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

async function startApi(): Promise<TestApi> {
  const store = await createArchitectureStore();
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
    route_decorators: []
  };
}

async function postOverlay(baseUrl: string, overlays: ArchitectureOverlays, source = "test-updater") {
  return requestJson(baseUrl, "/api/overlays/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { overlays, source, generatedAt: "2026-05-25T12:00:00.000Z" }
  });
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

  it("accepts a valid full overlay snapshot and exposes it in the public payload", async () => {
    const api = await startApi();
    try {
      expect((await postOverlay(api.baseUrl, liveOverlay("42"))).status).toBe(200);

      const payload = await readArchitecture(api.baseUrl);
      expect(payload.overlaySource).toBe("test-updater");
      expect(payload.overlayStatus.state).toBe("dynamic");
      expect(payload.overlayGeneratedAt).toBe("2026-05-25T12:00:00.000Z");
      expect(payload.overlays.node_decorators[0]?.metrics[0]).toEqual({ label: "lag", value: "42" });
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
        route_decorators: []
      };
      expect((await postOverlay(api.baseUrl, invalid)).status).toBe(422);

      const payload = await readArchitecture(api.baseUrl);
      expect(payload.overlays.node_decorators[0]?.id).toBe("live-hot-products-lag");
      expect(payload.overlays.node_decorators[0]?.metrics[0]?.value).toBe("77");
      expect(payload.overlayStatus.state).toBe("error");
      expect(payload.overlayStatus.message).toContain("missing node");
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
      await expect(eventText).resolves.toContain(`"overlaySource":"${SAMPLE_LIVE_TPS_SOURCE}"`);
    } finally {
      await api.close();
    }
  });
});
