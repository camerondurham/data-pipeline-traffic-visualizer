import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArchitectureStore } from "./architectureStore";
import type { OverlayControlValueUpdateRequest } from "../runtime/types";

type NextFunction = () => void;

const MAX_BODY_BYTES = 2 * 1024 * 1024;

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

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
  try {
    return JSON.parse(body);
  } catch {
    throw new BadRequestError("Malformed JSON request body");
  }
}

async function readArchitectureSourceBody(request: IncomingMessage): Promise<{ architectureYaml: string; overlaysYaml: string }> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.architectureYaml !== "string" || typeof body.overlaysYaml !== "string") {
    throw new BadRequestError("architectureYaml and overlaysYaml are required strings");
  }
  return {
    architectureYaml: body.architectureYaml,
    overlaysYaml: body.overlaysYaml
  };
}

async function readOverlayControlValueBody(request: IncomingMessage): Promise<OverlayControlValueUpdateRequest> {
  const body = await readJson(request);
  if (!isRecord(body) || typeof body.controlId !== "string") {
    throw new BadRequestError("controlId is required");
  }
  return {
    controlId: body.controlId,
    ...(Object.hasOwn(body, "desiredValue") ? { desiredValue: body.desiredValue } : {}),
    ...(Object.hasOwn(body, "priority") ? { priority: body.priority } : {}),
    source: typeof body.source === "string" ? body.source : undefined,
    generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
        const body = await readArchitectureSourceBody(request);
        sendJson(response, 200, store.lintSource(body.architectureYaml, body.overlaysYaml));
        return;
      }

      if (method === "POST" && url.pathname === "/api/architecture/draft") {
        const body = await readArchitectureSourceBody(request);
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
        const body = await readJson(request);
        if (!isRecord(body)) {
          throw new BadRequestError("Request body must be a JSON object");
        }
        const result = store.updateOverlaySnapshot({
          overlays: body.overlays,
          source: typeof body.source === "string" ? body.source : undefined,
          generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : undefined
        });
        sendJson(response, result.ok ? 200 : 422, result);
        return;
      }

      if (method === "POST" && url.pathname === "/api/overlays/control-value") {
        if (!store.graphControlsPreviewEnabled) {
          sendJson(response, 403, { error: "Graph controls preview is disabled" });
          return;
        }
        const body = await readOverlayControlValueBody(request);
        const result = store.updateOverlayControlValue(body);
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
