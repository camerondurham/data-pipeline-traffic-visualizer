import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { validateOverlayReferences } from "./overlays";
import { buildSampleLiveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE } from "./sampleLiveTps";
import { validateArchitectureManifest, validateArchitectureOverlays, type ArchitectureOverlays } from "./zod";

function loadSeedOverlays(): ArchitectureOverlays {
  return validateArchitectureOverlays(parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8")));
}

describe("sample live TPS overlays", () => {
  it("builds a complete overlay snapshot with stable live TPS decorators", () => {
    const manifest = validateArchitectureManifest(parse(readFileSync("data/sample/architecture.yaml", "utf8")));
    const seedOverlays = loadSeedOverlays();
    const snapshot = buildSampleLiveTpsOverlays(seedOverlays, { tick: 3 });

    validateOverlayReferences(manifest, snapshot);
    expect(SAMPLE_LIVE_TPS_SOURCE).toBe("sample-live-tps");
    expect(snapshot.node_decorators.map((decorator) => decorator.id)).toContain("live-tps-orders-ingestion-stream");
    expect(snapshot.edge_decorators.map((decorator) => decorator.id)).toContain("live-tps-edge-web-orders-ingestion");
    expect(snapshot.node_decorators.find((decorator) => decorator.id === "orders-stream-capacity")).toBeDefined();
    expect(snapshot.route_decorators).toEqual(seedOverlays.route_decorators);
  });

  it("changes TPS values between ticks without mutating the seed overlays", () => {
    const seedOverlays = loadSeedOverlays();
    const firstSnapshot = buildSampleLiveTpsOverlays(seedOverlays, { tick: 0 });
    const nextSnapshot = buildSampleLiveTpsOverlays(seedOverlays, { tick: 1 });

    const firstOrdersTps = firstSnapshot.node_decorators.find(
      (decorator) => decorator.id === "live-tps-orders-ingestion-stream"
    )?.metrics[0];
    const nextOrdersTps = nextSnapshot.node_decorators.find(
      (decorator) => decorator.id === "live-tps-orders-ingestion-stream"
    )?.metrics[0];
    const firstWebEdge = firstSnapshot.edge_decorators.find(
      (decorator) => decorator.id === "live-tps-edge-web-orders-ingestion"
    );
    const nextWebEdge = nextSnapshot.edge_decorators.find(
      (decorator) => decorator.id === "live-tps-edge-web-orders-ingestion"
    );

    expect(firstOrdersTps?.label).toBe("TPS");
    expect(firstOrdersTps?.value).not.toBe(nextOrdersTps?.value);
    expect(firstWebEdge?.metric_label).toMatch(/ TPS$/);
    expect(firstWebEdge?.metric_label).not.toBe(nextWebEdge?.metric_label);
    expect(seedOverlays.node_decorators.some((decorator) => decorator.id.startsWith("live-tps-"))).toBe(false);
    expect(seedOverlays.edge_decorators.some((decorator) => decorator.id.startsWith("live-tps-"))).toBe(false);
  });
});
