import architectureFixture from "../../public/config/architecture.json";
import trafficFixture from "../../public/config/traffic-snapshot.json";
import desiredFixture from "../../public/config/desired-throttles.json";
import { parseArchitecture, parseThrottleSnapshot, parseTrafficSnapshot } from "./parsers";
import type { ArchitectureConfig } from "../types";

describe("snapshot parsers", () => {
  it("parses the seeded architecture, throttle, and traffic snapshots", () => {
    const architecture = parseArchitecture(architectureFixture);
    const desired = parseThrottleSnapshot(desiredFixture, "desired");
    const traffic = parseTrafficSnapshot(trafficFixture);

    expect(architecture.nodes.length).toBeGreaterThan(20);
    expect(desired.services["event-enrichment"].rules).toHaveLength(3);
    expect(traffic.summary.totalIngestTps).toBe(128512);
  });

  it("allows multiple producers to publish into the same stream", () => {
    const config: ArchitectureConfig = {
      version: 1,
      updatedAt: "2026-05-23T00:00:00.000Z",
      kinesisDefaults: {
        writeRecordsPerShardPerSecond: 1000,
        writeMbPerShardPerSecond: 1,
        readMbPerShardPerSecond: 2
      },
      tiers: [{ id: "test", name: "Test", order: 1 }],
      nodes: [
        { id: "producer-a", name: "Producer A", type: "producer", tier: "test", summary: "A" },
        { id: "producer-b", name: "Producer B", type: "producer", tier: "test", summary: "B" },
        {
          id: "shared-stream",
          name: "Shared Stream",
          type: "kinesisStream",
          tier: "test",
          summary: "shared",
          kinesis: { shardCount: 2 }
        }
      ],
      edges: [
        { from: "producer-a", to: "shared-stream", label: "publish" },
        { from: "producer-b", to: "shared-stream", label: "publish" }
      ]
    };

    expect(parseArchitecture(config).edges.filter((edge) => edge.to === "shared-stream")).toHaveLength(2);
  });

  it("rejects topology edges that reference unknown nodes", () => {
    const broken = {
      ...architectureFixture,
      edges: [{ from: "missing", to: "aggregate-stream", label: "bad" }]
    };

    expect(() => parseArchitecture(broken)).toThrow(/unknown node/);
  });
});
