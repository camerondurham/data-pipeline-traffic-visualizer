#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parse } from "yaml";
import { createServer } from "vite";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5173);
const intervalMs = Number(process.env.LIVE_TPS_INTERVAL_MS ?? 2000);

const server = await createServer({
  server: {
    host,
    port,
    strictPort: false
  }
});

let interval;
let tick = 0;
let closing = false;

async function close() {
  if (closing) {
    return;
  }
  closing = true;
  if (interval) {
    clearInterval(interval);
  }
  await server.close();
}

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

await server.listen();
server.printUrls();

const localUrl = server.resolvedUrls?.local[0] ?? `http://${host}:${port}/`;
const apiBaseUrl = localUrl.replace(/\/$/, "");
const [{ buildSampleLiveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE }, { validateArchitectureOverlays }] =
  await Promise.all([
    server.ssrLoadModule("/src/sampleLiveTps.ts"),
    server.ssrLoadModule("/src/zod.ts")
  ]);
const baseOverlays = validateArchitectureOverlays(parse(await readFile("data/sample/architecture-overlays.yaml", "utf8")));

async function postSnapshot() {
  const generatedAt = new Date().toISOString();
  const overlays = buildSampleLiveTpsOverlays(baseOverlays, { tick });
  const response = await fetch(`${apiBaseUrl}/api/overlays/snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      overlays,
      source: SAMPLE_LIVE_TPS_SOURCE,
      generatedAt
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Overlay snapshot rejected with ${response.status}: ${body}`);
  }

  console.log(`[live-tps] posted tick ${tick} at ${generatedAt}`);
  tick += 1;
}

try {
  await postSnapshot();
  interval = setInterval(() => {
    void postSnapshot().catch((error) => {
      console.error(`[live-tps] ${error instanceof Error ? error.message : String(error)}`);
    });
  }, intervalMs);
  console.log(`[live-tps] posting sample overlay snapshots to ${apiBaseUrl}/api/overlays/snapshot every ${intervalMs}ms`);
} catch (error) {
  console.error(`[live-tps] ${error instanceof Error ? error.message : String(error)}`);
  await close();
  process.exit(1);
}
