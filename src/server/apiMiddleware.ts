import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArchitectureStore } from "./architectureStore";

type NextFunction = () => void;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request);
  if (!body.trim()) {
    return {};
  }
  return JSON.parse(body);
}

function sendSseEvent(response: ServerResponse, eventName: string, data: unknown): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function createArchitectureApiMiddleware(store: ArchitectureStore) {
  return async function architectureApiMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next?: NextFunction
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const method = request.method ?? "GET";

    try {
      if (method === "GET" && url.pathname === "/api/architecture") {
        sendJson(response, 200, store.getPayload());
        return;
      }

      if (method === "GET" && url.pathname === "/api/architecture/events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        sendSseEvent(response, "revision", store.getPayload());
        const unsubscribe = store.subscribe((event) => sendSseEvent(response, "revision", event));
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 25_000);
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

      // Add authentication here before exposing runtime edits outside a trusted environment.
      if (method === "GET" && url.pathname === "/api/architecture/source") {
        sendJson(response, 200, store.getSource());
        return;
      }

      if (method === "POST" && url.pathname === "/api/architecture/lint") {
        const body = (await readJson(request)) as { architectureYaml?: unknown; overlaysYaml?: unknown };
        if (typeof body.architectureYaml !== "string" || typeof body.overlaysYaml !== "string") {
          sendJson(response, 400, { error: "architectureYaml and overlaysYaml are required strings" });
          return;
        }
        sendJson(response, 200, store.lintSource(body.architectureYaml, body.overlaysYaml));
        return;
      }

      if (method === "POST" && url.pathname === "/api/architecture/draft") {
        const body = (await readJson(request)) as { architectureYaml?: unknown; overlaysYaml?: unknown };
        if (typeof body.architectureYaml !== "string" || typeof body.overlaysYaml !== "string") {
          sendJson(response, 400, { error: "architectureYaml and overlaysYaml are required strings" });
          return;
        }
        const result = store.applyDraft(body.architectureYaml, body.overlaysYaml);
        sendJson(response, result.ok ? 200 : 422, result);
        return;
      }

      if (method === "DELETE" && url.pathname === "/api/architecture/draft") {
        await store.resetDraft();
        sendEmpty(response, 204);
        return;
      }

      if (method === "POST" && url.pathname === "/api/overlays/snapshot") {
        const body = (await readJson(request)) as { overlays?: unknown; source?: unknown; generatedAt?: unknown };
        const result = store.updateOverlaySnapshot({
          overlays: body.overlays as never,
          source: typeof body.source === "string" ? body.source : undefined,
          generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : undefined
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
      sendJson(response, 500, { error: error instanceof Error ? error.message : "Unknown architecture runtime error" });
    }
  };
}
