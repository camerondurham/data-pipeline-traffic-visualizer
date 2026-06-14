#!/usr/bin/env node
import process from "node:process";
import { createServer } from "vite";

let timer;
let closing = false;

const loader = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  optimizeDeps: {
    entries: [],
    noDiscovery: true
  },
  root: process.cwd(),
  server: {
    middlewareMode: true
  }
});

const {
  readAwsOverlayCollectorConfig,
  runAwsOverlayCollectorOnce,
  shouldRunOnceFromArgs
} = await loader.ssrLoadModule("/src/awsOverlayCollector.ts");

const args = process.argv.slice(2);
const env = { ...process.env };
if (args.includes("--stub")) {
  env.AWS_OVERLAY_STUB_MODE = "ok";
}
if (args.includes("--stub-partial")) {
  env.AWS_OVERLAY_STUB_MODE = "partial";
}

const config = readAwsOverlayCollectorConfig(env);
const once = shouldRunOnceFromArgs(args, env);

async function close() {
  if (closing) {
    return;
  }
  closing = true;
  if (timer) {
    clearTimeout(timer);
  }
  await loader.close();
}

function logSummary(summary) {
  console.log(
    [
      `[aws-overlays] posted ${summary.bindingCount} bindings at ${summary.generatedAt}`,
      `ok=${summary.okCount}`,
      `missing=${summary.missingCount}`,
      `error=${summary.errorCount}`
    ].join(" ")
  );
}

async function collectOnce() {
  const summary = await runAwsOverlayCollectorOnce(config);
  logSummary(summary);
}

function scheduleNextCollection() {
  if (closing) {
    return;
  }
  timer = setTimeout(() => {
    timer = undefined;
    void collectOnce()
      .catch((error) => {
        console.error(`[aws-overlays] ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(scheduleNextCollection);
  }, config.intervalMs);
}

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

try {
  await collectOnce();
  if (once) {
    await close();
    process.exit(0);
  }

  scheduleNextCollection();
  console.log(
    `[aws-overlays] posting ${config.source} snapshots to ${config.overlayApiUrl} every ${config.intervalMs}ms from ${config.bindingsPath}`
  );
} catch (error) {
  console.error(`[aws-overlays] ${error instanceof Error ? error.message : String(error)}`);
  await close();
  process.exit(1);
}
