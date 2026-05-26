import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = resolve(repoRoot, "docs", "architecture-workflow.png");
const editorScreenshotPath = resolve(repoRoot, "docs", "architecture-workflow-editor.png");
const port = process.env.SCREENSHOT_PORT ?? "4174";
const url = `http://127.0.0.1:${port}/`;
const serverBin = resolve(repoRoot, "dist-server", "startServer.js");

function startPreview() {
  const child = spawn(process.execPath, [serverBin], {
    cwd: repoRoot,
    env: { ...process.env, HOST: "127.0.0.1", PORT: port },
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

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("flow-diagram").waitFor();
    await page.locator('[data-id="edge.use1.aggregate.to.hot.router"]').waitFor();
    await page.locator(".flow-panel").first().screenshot({ path: screenshotPath });
    await page.getByRole("button", { name: /Runtime YAML/i }).click();
    await page.getByLabel("architecture.yaml").waitFor();
    await page.waitForFunction(() => {
      const editor = document.querySelector('textarea[aria-label="architecture.yaml"]');
      return editor instanceof HTMLTextAreaElement && editor.value.includes("nodes:");
    });
    await page.locator(".app-shell").screenshot({ path: editorScreenshotPath });

    console.log(`Captured ${screenshotPath}`);
    console.log(`Captured ${editorScreenshotPath}`);
  } finally {
    await browser?.close();
    preview.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
