import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = resolve(repoRoot, "docs", "architecture-workflow.png");
const port = process.env.SCREENSHOT_PORT ?? "4174";
const url = `http://127.0.0.1:${port}/`;
const viteBin = resolve(repoRoot, "node_modules", "vite", "bin", "vite.js");

function startPreview() {
  const child = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", port, "--strictPort"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  await mkdir(dirname(screenshotPath), { recursive: true });

  const preview = startPreview();
  let browser;

  try {
    await waitForPreview();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 4600, height: 1300 }, deviceScaleFactor: 1 });

    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-diagram").waitFor();
    await page.locator('[data-id="edge.use1.aggregate.to.hot.router"]').waitFor();
    await page.locator(".flow-panel").first().screenshot({ path: screenshotPath });

    console.log(`Captured ${screenshotPath}`);
  } finally {
    await browser?.close();
    preview.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
