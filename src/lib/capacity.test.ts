import architectureFixture from "../../public/config/architecture.json";
import trafficFixture from "../../public/config/traffic-snapshot.json";
import { getKinesisWriteCapacity, getNodeCapacity, getNodeStatus } from "./capacity";
import { parseArchitecture, parseTrafficSnapshot } from "./parsers";
import type { ArchitectureNode } from "../types";

describe("capacity helpers", () => {
  const architecture = parseArchitecture(architectureFixture);
  const traffic = parseTrafficSnapshot(trafficFixture);

  it("calculates Kinesis write capacity from shard count and defaults", () => {
    const node = architecture.nodes.find((candidate) => candidate.id === "aggregate-stream");

    expect(getKinesisWriteCapacity(node!, architecture.kinesisDefaults)).toBe(96000);
  });

  it("honors per-stream Kinesis record capacity overrides", () => {
    const node: ArchitectureNode = {
      id: "override-stream",
      name: "Override Stream",
      type: "kinesisStream",
      tier: "test",
      summary: "override",
      kinesis: { shardCount: 4, writeRecordsPerShardPerSecond: 1500 }
    };

    expect(getKinesisWriteCapacity(node, architecture.kinesisDefaults)).toBe(6000);
  });

  it("reports aggregate stream headroom and utilization", () => {
    const node = architecture.nodes.find((candidate) => candidate.id === "aggregate-stream");
    const capacity = getNodeCapacity(node!, traffic.nodes["aggregate-stream"], architecture);

    expect(capacity?.capacityTps).toBe(96000);
    expect(capacity?.headroomTps).toBe(8065);
    expect(capacity?.status).toBe("critical");
  });

  it("marks drifted services as critical even when utilization is below threshold", () => {
    const node = architecture.nodes.find((candidate) => candidate.id === "stream-router");

    expect(getNodeStatus(node!, traffic.nodes["stream-router"], architecture, true)).toBe("critical");
  });
});
