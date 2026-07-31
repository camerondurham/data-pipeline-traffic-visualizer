import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const screenshotPath = resolve(repoRoot, "docs", "architecture-workflow.png");
const editorScreenshotPath = resolve(repoRoot, "docs", "architecture-workflow-editor.png");
const representativeEdgeCount = 22;
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

async function waitForRepresentativePipeline(page) {
  await page.getByTestId("flow-diagram").waitFor();
  await page.locator('[data-id="edge.use1.sources.web.to.orders.ingestion"]').waitFor({ state: "attached" });
  await page.locator('[data-id="edge.use1.hot.indexers.to.orders.cluster"]').waitFor({ state: "attached" });
  await page.locator('[aria-label="Select edge publish orders"]').waitFor();
  await page.locator('[aria-label="Select edge bulk index orders"]').waitFor();
  await page.locator('[aria-label="Select edge replay enriched events"]').waitFor();
  await page.waitForTimeout(600);
}

async function assertCompactOverlayLabelsDoNotOverlap(page) {
  const compactLabels = page.locator(".edge-label.is-overlay-visible");
  const primaryMetricChips = compactLabels.locator(".edge-label-primary-chip");
  const renderedMetricCount = await primaryMetricChips.count();
  if (renderedMetricCount !== representativeEdgeCount) {
    throw new Error(
      `Expected ${representativeEdgeCount} compact primary metrics, rendered ${renderedMetricCount}`
    );
  }
  const hiddenMetricLabels = await primaryMetricChips.evaluateAll((chips) =>
    chips
      .filter((chip) => {
        const rect = chip.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return true;
        }
        let current = chip;
        while (current instanceof HTMLElement) {
          const style = window.getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            Number.parseFloat(style.opacity) <= 0
          ) {
            return true;
          }
          current = current.parentElement;
        }
        return false;
      })
      .map((chip) => chip.closest(".edge-label")?.getAttribute("aria-label") ?? "unknown edge")
  );
  if (hiddenMetricLabels.length > 0) {
    throw new Error(`Compact primary metrics are not visible:\n${hiddenMetricLabels.join("\n")}`);
  }

  const overlaps = await compactLabels.evaluateAll((labels) => {
    const entries = labels
      .map((label) => ({
        name: label.getAttribute("aria-label") ?? "unknown edge",
        rect: label.getBoundingClientRect()
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    const collisions = [];

    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        const overlapWidth = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const overlapHeight = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);

        if (overlapWidth > 1 && overlapHeight > 1) {
          collisions.push(`${left.name} overlaps ${right.name}`);
        }
      }
    }

    return collisions;
  });

  if (overlaps.length > 0) {
    throw new Error(`Compact overlay labels overlap at laptop width:\n${overlaps.join("\n")}`);
  }
}

async function assertExpandedOverlayDetailsWrap(page) {
  const edgeLabel = page.locator('[aria-label="Select edge publish orders"]');
  await edgeLabel.hover();
  const overlayChips = edgeLabel.locator(".edge-label-overlay-chips");
  const chipState = await overlayChips.evaluate((container) => ({
    flexWrap: window.getComputedStyle(container).flexWrap,
    visibleChipCount: Array.from(container.querySelectorAll("b")).filter((chip) => {
      const rect = chip.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      let current = chip;
      while (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number.parseFloat(style.opacity) <= 0
        ) {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    }).length
  }));

  if (chipState.flexWrap !== "wrap" || chipState.visibleChipCount !== 3) {
    throw new Error(
      `Expected expanded overlay details to wrap with 3 visible chips, got ${chipState.flexWrap} and ${chipState.visibleChipCount}`
    );
  }
}

async function main() {
  await mkdir(dirname(screenshotPath), { recursive: true });

  const preview = startPreview();
  let browser;

  try {
    await waitForPreview();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 2800, height: 1400 }, deviceScaleFactor: 1 });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await waitForRepresentativePipeline(page);
    await page.locator(".flow-panel").first().screenshot({ path: screenshotPath });
    await page.getByRole("button", { name: /Runtime YAML/i }).click();
    await page.getByLabel("architecture.yaml").waitFor();
    await page.waitForFunction(() => {
      const editor = document.querySelector('textarea[aria-label="architecture.yaml"]');
      return editor instanceof HTMLTextAreaElement && editor.value.includes("nodes:");
    });
    await page.locator(".cloudscape-app-shell").screenshot({ path: editorScreenshotPath });

    const laptopPage = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await laptopPage.goto(url, { waitUntil: "domcontentloaded" });
    await laptopPage.getByRole("button", { name: "Dark", exact: true }).click();
    await waitForRepresentativePipeline(laptopPage);
    await assertCompactOverlayLabelsDoNotOverlap(laptopPage);
    await assertExpandedOverlayDetailsWrap(laptopPage);
    await laptopPage.close();

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
