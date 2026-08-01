import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { validateArchitectureManifest, validateArchitectureOverlays } from "./zod";

describe("representative sample pipeline", () => {
  it("opens on a service-to-resource pipeline with TPS on every edge", () => {
    const manifest = validateArchitectureManifest(parse(readFileSync("data/sample/architecture.yaml", "utf8")));
    const overlays = validateArchitectureOverlays(
      parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8"))
    );
    const view = manifest.views[0];

    expect(view.id).toBe("representative_data_pipeline");
    expect(view.mode).toBe("region");
    if (view.mode !== "region" || !view.stages) {
      throw new Error("Representative pipeline must be an explicit region view");
    }

    expect(view.lanes?.map((lane) => lane.id)).toEqual(["normal", "slow_lane"]);
    expect(view.stages.find((stage) => stage.id === "preagg_slow_queues")?.node_ids).toEqual([
      "use1.pre_agg.slow_queues"
    ]);
    expect(view.stages.find((stage) => stage.id === "preagg_slow_processor")?.node_ids).toEqual([
      "use1.pre_agg.slow_processor"
    ]);
    expect(view.stages.find((stage) => stage.id === "hot_slow_queues")?.node_ids).toEqual([
      "use1.hot.slow_queues"
    ]);
    expect(view.stages.find((stage) => stage.id === "hot_slow_processor")?.node_ids).toEqual([
      "use1.hot.slow_processor"
    ]);
    expect(view.stages.find((stage) => stage.id === "preagg_slow_queues")?.column).toBe(
      view.stages.find((stage) => stage.id === "ingestion_kinesis")?.column
    );
    expect(view.stages.find((stage) => stage.id === "preagg_slow_processor")?.column).toBe(
      view.stages.find((stage) => stage.id === "consumer_services")?.column
    );
    expect(view.stages.find((stage) => stage.id === "hot_slow_queues")?.column).toBe(
      view.stages.find((stage) => stage.id === "opensearch_clusters")?.column
    );
    expect(view.stages.find((stage) => stage.id === "hot_slow_processor")?.column).toBe(
      view.stages.find((stage) => stage.id === "query_service")?.column
    );

    const visibleNodeIds = new Set(view.stages.flatMap((stage) => stage.node_ids));
    const labelsById = new Map(manifest.nodes.map((node) => [node.id, node.label]));
    expect(labelsById.get("use1.sources.web_storefront")).toContain("Service");
    expect(labelsById.get("use1.ingestion.orders_stream")).toContain("Kinesis");
    expect(labelsById.get("use1.processing.orders_app")).toContain("Service");
    expect(labelsById.get("use1.hot.cluster.orders")).toContain("OpenSearch");

    const visibleEdges = manifest.edges.filter(
      (edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
    );
    expect(visibleEdges.length).toBeGreaterThanOrEqual(22);
    expect(visibleEdges.filter((edge) => ["sideline", "drain", "replay"].includes(edge.type))).toHaveLength(8);

    for (const edge of visibleEdges) {
      const decorator = overlays.edge_decorators.find((candidate) => candidate.edge_id === edge.id);
      expect(decorator, `missing edge overlay for ${edge.id}`).toBeDefined();
      expect(decorator?.metric_label, `missing TPS label for ${edge.id}`).toMatch(/ TPS$/);
      expect(
        decorator?.metrics.some((metric) => metric.label === "TPS"),
        `missing TPS metric for ${edge.id}`
      ).toBe(true);
    }
  });
});
