import "./test/setup";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildGraphModel, type VisualEdge } from "./graphBuilder";
import {
  buildOverlayModel,
  resolveEdgeOverlay,
  resolveNodeOverlay,
  validateOverlayReferences
} from "./overlays";
import {
  validateArchitectureManifest,
  validateArchitectureOverlays,
  type ArchitectureManifest,
  type ArchitectureOverlays
} from "./zod";

function loadSeedManifest(): ArchitectureManifest {
  return validateArchitectureManifest(parse(readFileSync("data/sample/architecture.yaml", "utf8")));
}

function loadSeedOverlays(): ArchitectureOverlays {
  return validateArchitectureOverlays(parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8")));
}

function overlayFixture(): ArchitectureOverlays {
  return {
    node_decorators: [
      {
        id: "node-capacity",
        node_id: "use1.child.a",
        title: "A capacity",
        metrics: [{ label: "shards", value: 4 }],
        badges: [],
        notes: []
      }
    ],
    edge_decorators: [
      {
        id: "edge-a-throughput",
        edge_id: "edge.a.remote",
        title: "A throughput",
        metric_label: "2k msg/s",
        badges: ["stream"],
        metrics: [],
        warning: true
      },
      {
        id: "edge-b-capacity",
        edge_id: "edge.b.remote",
        title: "B capacity",
        badges: ["bulk"],
        metrics: [{ label: "batch", value: 200 }]
      }
    ],
    route_decorators: [
      {
        id: "route-a",
        source_node_id: "use1.child.a",
        title: "A route",
        edge_ids: ["edge.a.remote"],
        badges: ["throttle 500/s"],
        metrics: []
      }
    ],
    controls: [
      {
        id: "edge-a-token-throttle",
        target: { kind: "edge", id: "edge.a.remote" },
        dimensions: { token: "partner-v3" },
        label: "A token throttle",
        apply: {
          handler: "simulated-throttle-config"
        },
        spec: {
          value_type: "number",
          min: 0,
          max: 1000,
          step: 50,
          unit: "/s",
          priority: {
            editable: true,
            min: 0,
            max: 100,
            step: 1
          }
        },
        state: {
          desired_value: 500,
          effective_value: 500,
          priority: 20,
          apply: {
            phase: "idle"
          }
        }
      }
    ]
  };
}

function smallManifest(): ArchitectureManifest {
  return {
    nodes: [
      { id: "use1.group", label: "Use1 Group", type: "group", region: "use1", zone: "hot" },
      { id: "use1.child.a", label: "Use1 A", type: "app", region: "use1", zone: "hot", parent: "use1.group" },
      { id: "use1.child.b", label: "Use1 B", type: "app", region: "use1", zone: "hot", parent: "use1.group" },
      { id: "usw2.group", label: "Usw2 Group", type: "group", region: "usw2", zone: "partner" },
      { id: "usw2.child.a", label: "Usw2 A", type: "stream", region: "usw2", zone: "partner", parent: "usw2.group" },
      { id: "usw2.child.b", label: "Usw2 B", type: "stream", region: "usw2", zone: "partner", parent: "usw2.group" }
    ],
    edges: [
      { id: "edge.a.remote", from: "use1.child.a", to: "usw2.child.a", type: "publish" },
      { id: "edge.b.remote", from: "use1.child.b", to: "usw2.child.b", type: "publish" }
    ],
    views: [{ id: "regional", label: "Regional", mode: "region", region: "use1" }]
  };
}

describe("overlays", () => {
  it("validates the seed overlay file against the seed architecture manifest", () => {
    expect(() => buildOverlayModel(loadSeedManifest(), loadSeedOverlays())).not.toThrow();
  });

  it("rejects missing node and edge references", () => {
    const manifest = smallManifest();

    expect(() =>
      validateOverlayReferences(manifest, {
        ...overlayFixture(),
        node_decorators: [{ ...overlayFixture().node_decorators[0], node_id: "missing.node" }]
      })
    ).toThrow(/missing node/);

    expect(() =>
      validateOverlayReferences(manifest, {
        ...overlayFixture(),
        edge_decorators: [{ ...overlayFixture().edge_decorators[0], edge_id: "missing.edge" }]
      })
    ).toThrow(/missing edge/);
  });

  it("rejects duplicate decorator IDs and non-contiguous explicit routes", () => {
    const manifest = smallManifest();

    expect(() =>
      validateOverlayReferences(manifest, {
        ...overlayFixture(),
        edge_decorators: [{ ...overlayFixture().edge_decorators[0], id: "node-capacity" }]
      })
    ).toThrow(/Duplicate overlay id/);

    expect(() =>
      validateOverlayReferences(manifest, {
        ...overlayFixture(),
        route_decorators: [
          {
            ...overlayFixture().route_decorators[0],
            source_node_id: "use1.child.b",
            edge_ids: ["edge.a.remote"]
          }
        ]
      })
    ).toThrow(/non-contiguous route/);
  });

  it("validates editable control references and value specs", () => {
    const manifest = smallManifest();

    expect(() => validateOverlayReferences(manifest, overlayFixture())).not.toThrow();

    expect(() =>
      validateOverlayReferences(manifest, {
        ...overlayFixture(),
        controls: [
          {
            ...overlayFixture().controls[0],
            target: { kind: "edge", id: "missing.edge" }
          }
        ]
      })
    ).toThrow(/missing edge/);

    expect(() =>
      validateArchitectureOverlays({
        ...overlayFixture(),
        controls: [
          {
            ...overlayFixture().controls[0],
            state: { desired_value: 1200, apply: { phase: "idle" } }
          }
        ]
      })
    ).toThrow(/less than or equal to 1000/);

    expect(() =>
      validateArchitectureOverlays({
        ...overlayFixture(),
        controls: [
          {
            ...overlayFixture().controls[0],
            state: { desired_value: "500", apply: { phase: "idle" } }
          }
        ]
      })
    ).toThrow(/expected number control value/);

    expect(() =>
      validateArchitectureOverlays({
        ...overlayFixture(),
        controls: [
          {
            ...overlayFixture().controls[0],
            apply: undefined,
            state: { desired_value: 500, effective_value: 500, priority: 20 }
          }
        ]
      })
    ).toThrow(/Required/);

    expect(() =>
      validateArchitectureOverlays({
        ...overlayFixture(),
        controls: [
          {
            ...overlayFixture().controls[0],
            state: { desired_value: 500, effective_value: 500, priority: 20 }
          }
        ]
      })
    ).toThrow(/Required/);
  });

  it("resolves node, edge, and route decorators", () => {
    const manifest = smallManifest();
    const graph = buildGraphModel(manifest);
    const nodeControl = {
      ...overlayFixture().controls[0],
      id: "node-b-token-throttle",
      target: { kind: "node" as const, id: "use1.child.b" },
      label: "B node throttle"
    };
    const overlayModel = buildOverlayModel(manifest, {
      ...overlayFixture(),
      controls: [...overlayFixture().controls, nodeControl]
    });

    expect(resolveNodeOverlay(overlayModel, "use1.child.a")?.chips).toEqual(["4 shards"]);
    const nodeControlOverlay = resolveNodeOverlay(overlayModel, "use1.child.b");
    expect(nodeControlOverlay?.decorators).toEqual([]);
    expect(nodeControlOverlay?.controls.map((control) => control.id)).toEqual(["node-b-token-throttle"]);

    const singleEdge = graph.edges.find((edge) => edge.id === "edge.a.remote") as VisualEdge;
    const singleOverlay = resolveEdgeOverlay(overlayModel, singleEdge);
    expect(singleOverlay?.metricLabel).toBe("2k msg/s");
    expect(singleOverlay?.badges).toEqual(expect.arrayContaining(["stream", "throttle 500/s"]));
    expect(singleOverlay?.routeDecorators.map((decorator) => decorator.id)).toEqual(["route-a"]);

    const otherEdge = graph.edges.find((edge) => edge.id === "edge.b.remote") as VisualEdge;
    expect(resolveEdgeOverlay(overlayModel, otherEdge)?.routeDecorators).toEqual([]);

    const directEdge = graph.visualEdges.find((edge) => edge.id === "edge.b.remote");
    const directOverlay = resolveEdgeOverlay(overlayModel, directEdge as VisualEdge);
    expect(directOverlay?.edgeDecorators.map((decorator) => decorator.id)).toEqual(["edge-b-capacity"]);
    expect(directOverlay?.badges).toEqual(expect.arrayContaining(["bulk", "200 batch"]));
  });
});
