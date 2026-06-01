import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { PRODUCT_NAME } from "../branding";
import { createArchitectureStore } from "./architectureStore";
import { createArchitectureApiMiddleware } from "./apiMiddleware";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4173);
const distDir = resolve(process.cwd(), "dist");
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function sendText(response: ServerResponse, status: number, message: string): void {
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

function safeStaticPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname.split("?")[0] ?? "/");
  const normalizedPath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const relativePath = normalizedPath === "/" ? "index.html" : normalizedPath.replace(/^[/\\]/, "");
  return resolve(join(distDir, relativePath));
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
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
    void serveStatic(request.url ?? "/", response).catch((error: unknown) => {
      sendText(
        response,
        error instanceof URIError ? 400 : 500,
        error instanceof URIError ? "Malformed request path" : "Unable to serve request"
      );
    });
  });
});

server.listen(port, host, () => {
  console.log(`${PRODUCT_NAME} listening on http://${host}:${port}`);
});
