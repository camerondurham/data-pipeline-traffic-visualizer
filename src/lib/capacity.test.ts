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

  it("treats zero stream capacity as fully saturated and critical", () => {
    const node: ArchitectureNode = {
      id: "zero-shard-stream",
      name: "Zero Shard Stream",
      type: "kinesisStream",
      tier: "test",
      summary: "misconfigured",
      kinesis: { shardCount: 0 }
    };
    const capacity = getNodeCapacity(node, { writeTps: 100 }, architecture);

    expect(capacity?.capacityTps).toBe(0);
    expect(capacity?.utilization).toBe(1);
    expect(capacity?.status).toBe("critical");
  });

  it("treats zero processing capacity as fully saturated and critical", () => {
    const node: ArchitectureNode = {
      id: "zero-service",
      name: "Zero Service",
      type: "service",
      tier: "test",
      summary: "misconfigured",
      capacity: { maxTps: 0 }
    };
    const capacity = getNodeCapacity(node, { processingTps: 10 }, architecture);

    expect(capacity?.capacityTps).toBe(0);
    expect(capacity?.utilization).toBe(1);
    expect(capacity?.status).toBe("critical");
  });
});
