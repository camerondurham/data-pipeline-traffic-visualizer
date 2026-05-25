import "./test/setup";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import {
  buildGraphModel,
  getCrossRegionGroups,
  getFlowLayout,
  getFocusView,
  requireView
} from "./graphBuilder";
import { validateArchitectureManifest, type ArchitectureManifest } from "./zod";

function loadSeedManifest(): ArchitectureManifest {
  const yaml = readFileSync("public/architecture.yaml", "utf8");
  return validateArchitectureManifest(parse(yaml));
}

function smallManifest(): ArchitectureManifest {
  return {
    nodes: [
      { id: "use1.group", label: "Use1 Group", type: "group", region: "use1", zone: "hot", collapsed: true },
      { id: "use1.a", label: "Use1 A", type: "app", region: "use1", zone: "hot", parent: "use1.group" },
      { id: "use1.b", label: "Use1 B", type: "app", region: "use1", zone: "hot", parent: "use1.group" },
      { id: "usw2.group", label: "Usw2 Group", type: "group", region: "usw2", zone: "partner", collapsed: true },
      { id: "usw2.a", label: "Usw2 A", type: "stream", region: "usw2", zone: "partner", parent: "usw2.group" },
      { id: "usw2.b", label: "Usw2 B", type: "stream", region: "usw2", zone: "partner", parent: "usw2.group" }
    ],
    edges: [
      { id: "edge.a.to.remote.a", from: "use1.a", to: "usw2.a", type: "publish" },
      { id: "edge.b.to.remote.b", from: "use1.b", to: "usw2.b", type: "publish" },
      { id: "edge.a.to.b", from: "use1.a", to: "use1.b", type: "publish" }
    ],
    views: [
      { id: "regional_end_to_end", label: "Regional", mode: "region", region: "use1" },
      { id: "cross_region_detail", label: "Cross", mode: "cross_region", group_by: "destination_region" },
      {
        id: "representative_partner_path",
        label: "Focus",
        mode: "focus",
        focus_edges: ["edge.a.to.remote.a", "edge.b.to.remote.b"],
        primary_edges: ["edge.a.to.remote.a"],
        secondary_edges: ["edge.b.to.remote.b"]
      }
    ]
  };
}

describe("graphBuilder", () => {
  it("requires stable edge IDs and rejects duplicate edge IDs", () => {
    expect(() =>
      validateArchitectureManifest({
        nodes: [{ id: "a", label: "A", type: "app", region: "use1", zone: "hot" }],
        edges: [{ from: "a", to: "a", type: "publish" }],
        views: [{ id: "regional_end_to_end", label: "Regional", mode: "region", region: "use1" }]
      })
    ).toThrow();

    const manifest = smallManifest();
    manifest.edges[1] = { ...manifest.edges[1], id: manifest.edges[0].id };
    expect(() => buildGraphModel(manifest)).toThrow(/Duplicate edge id/);
  });

  it("rejects unsupported node zones and parent-reference cycles", () => {
    expect(() =>
      validateArchitectureManifest({
        nodes: [{ id: "a", label: "A", type: "app", region: "use1", zone: "pre_agregate" }],
        edges: [{ id: "edge.a.to.a", from: "a", to: "a", type: "publish" }],
        views: [{ id: "regional_end_to_end", label: "Regional", mode: "region", region: "use1" }]
      })
    ).toThrow();

    expect(() =>
      buildGraphModel({
        nodes: [
          { id: "a", label: "A", type: "app", region: "use1", zone: "hot", parent: "b" },
          { id: "b", label: "B", type: "app", region: "use1", zone: "hot", parent: "a" }
        ],
        edges: [{ id: "edge.a.to.b", from: "a", to: "b", type: "publish" }],
        views: [{ id: "regional_end_to_end", label: "Regional", mode: "region", region: "use1" }]
      })
    ).toThrow(/Parent cycle detected/);
  });

  it("derives crossRegion from original endpoints and preserves rolled-up sourceEdgeIds", () => {
    const model = buildGraphModel(smallManifest());
    const edge = model.visualEdges.find((candidate) => candidate.visibleFrom === "use1.group" && candidate.visibleTo === "usw2.group");

    expect(edge).toMatchObject({
      originalFrom: "use1.a",
      originalTo: "usw2.a",
      visibleFrom: "use1.group",
      visibleTo: "usw2.group",
      sourceRegion: "use1",
      destinationRegion: "usw2",
      crossRegion: true
    });
    expect(edge?.sourceEdgeIds).toEqual(["edge.a.to.remote.a", "edge.b.to.remote.b"]);
    expect(edge?.originalEdges.map((original) => `${original.from}->${original.to}`)).toEqual([
      "use1.a->usw2.a",
      "use1.b->usw2.b"
    ]);
  });

  it("deduplicates rolled-up visual edges and suppresses collapse self-loops", () => {
    const model = buildGraphModel(smallManifest());

    expect(model.visualEdges.filter((edge) => edge.visibleFrom === "use1.group" && edge.visibleTo === "usw2.group")).toHaveLength(1);
    expect(model.visualEdges.some((edge) => edge.sourceEdgeIds.includes("edge.a.to.b"))).toBe(false);
  });

  it("builds the seed destination-region cross-region groups", () => {
    const model = buildGraphModel(loadSeedManifest());
    const crossRegionGroups = getCrossRegionGroups(model, requireView(model, "cross_region_detail", "cross_region"));

    expect(crossRegionGroups.map((group) => group.destinationRegion)).toEqual(["euw1", "usw2"]);
    expect(crossRegionGroups.flatMap((group) => group.edges.flatMap((edge) => edge.sourceEdgeIds))).toEqual(
      expect.arrayContaining([
        "edge.use1.processing.to.usw2.aggregate",
        "edge.use1.processing.to.euw1.aggregate",
        "edge.use1.hot.router.to.usw2.partner.stream",
        "edge.use1.partner.slow_processor.to.usw2.partner.stream"
      ])
    );
  });

  it("builds the seed whiteboard-style regional flow stages from manifest node references", () => {
    const model = buildGraphModel(loadSeedManifest());
    const layout = getFlowLayout(model, requireView(model, "regional_end_to_end", "region"));

    expect(layout.stages.map((stage) => stage.id).slice(0, 4)).toEqual([
      "sourcing_apps",
      "ingestion_streams",
      "processing_apps",
      "preagg_slow_queues"
    ]);
    expect(layout.stages.find((stage) => stage.id === "aggregate_stream")?.nodes.map((node) => node.id)).toEqual([
      "use1.aggregate.stream"
    ]);
    expect(layout.edges.flatMap((edge) => edge.sourceEdgeIds)).toEqual(
      expect.arrayContaining([
        "edge.use1.sources.web.to.orders.ingestion",
        "edge.use1.mobile.ingestion.to.orders.processor",
        "edge.use1.aggregate.to.hot.router",
        "edge.use1.aggregate.to.cold.router",
        "edge.use1.hot.router.to.partner.stream"
      ])
    );
  });

  it("models the representative partner path with branching focus edges and source-local fallback", () => {
    const model = buildGraphModel(loadSeedManifest());
    const focus = getFocusView(model, requireView(model, "representative_partner_path", "focus"));
    const sourceEdgeIds = focus.edges.flatMap((edge) => edge.sourceEdgeIds);

    expect(sourceEdgeIds).toEqual(
      expect.arrayContaining([
        "edge.usw2.partner.indexer.to.cluster.a",
        "edge.usw2.partner.indexer.to.cluster.b",
        "edge.usw2.partner.indexer.to.cluster.c",
        "edge.use1.hot.router.to.partner.slow_streams",
        "edge.use1.partner.slow_streams.to.processor",
        "edge.use1.partner.slow_processor.to.usw2.partner.stream"
      ])
    );
    expect(focus.edges.filter((edge) => edge.emphasis === "primary")).toHaveLength(5);
    expect(focus.edges.filter((edge) => edge.emphasis === "secondary")).toHaveLength(3);
  });
});
