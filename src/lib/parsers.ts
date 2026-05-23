import type {
  ArchitectureConfig,
  ArchitectureEdge,
  ArchitectureNode,
  NodeType,
  ThrottleRule,
  ThrottleSnapshot,
  TrafficSnapshot
} from "../types";

const SUPPORTED_NODE_TYPES: NodeType[] = [
  "producer",
  "service",
  "router",
  "kinesisStream",
  "slowLane",
  "openSearchCluster",
  "api"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function assertArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value as T[];
}

function assertNodeType(value: unknown, label: string): NodeType {
  const nodeType = assertString(value, label);
  if (!SUPPORTED_NODE_TYPES.includes(nodeType as NodeType)) {
    throw new Error(`${label} must be one of: ${SUPPORTED_NODE_TYPES.join(", ")}`);
  }
  return nodeType as NodeType;
}

export function parseArchitecture(input: unknown): ArchitectureConfig {
  if (!isRecord(input)) {
    throw new Error("architecture config must be an object");
  }

  const nodes = assertArray<ArchitectureNode>(input.nodes, "architecture.nodes");
  const edges = assertArray<ArchitectureEdge>(input.edges, "architecture.edges");

  for (const node of nodes) {
    assertString(node.id, "node.id");
    assertString(node.name, `node(${node.id}).name`);
    assertNodeType(node.type, `node(${node.id}).type`);
    assertString(node.tier, `node(${node.id}).tier`);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    assertString(edge.from, "edge.from");
    assertString(edge.to, "edge.to");
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`edge references unknown node: ${edge.from} -> ${edge.to}`);
    }
  }

  const config = input as unknown as ArchitectureConfig;
  assertNumber(config.kinesisDefaults.writeRecordsPerShardPerSecond, "kinesis write record default");
  assertNumber(config.kinesisDefaults.writeMbPerShardPerSecond, "kinesis write MB default");
  assertNumber(config.kinesisDefaults.readMbPerShardPerSecond, "kinesis read MB default");
  return config;
}

export function parseThrottleSnapshot(input: unknown, expectedKind: "desired" | "live"): ThrottleSnapshot {
  if (!isRecord(input)) {
    throw new Error(`${expectedKind} throttle snapshot must be an object`);
  }

  const snapshot = input as unknown as ThrottleSnapshot;
  if (snapshot.snapshotKind !== expectedKind) {
    throw new Error(`expected ${expectedKind} throttle snapshot`);
  }

  if (!isRecord(snapshot.services)) {
    throw new Error(`${expectedKind}.services must be an object`);
  }

  for (const [serviceId, serviceConfig] of Object.entries(snapshot.services)) {
    assertString(serviceId, "service id");
    assertString(serviceConfig.updatedAt, `${serviceId}.updatedAt`);
    for (const rule of assertArray<ThrottleRule>(serviceConfig.rules, `${serviceId}.rules`)) {
      assertString(rule.id, `${serviceId}.rule.id`);
      assertString(rule.name, `${serviceId}.${rule.id}.name`);
      assertString(rule.throttleType, `${serviceId}.${rule.id}.throttleType`);
      assertString(rule.dimensions.schema, `${serviceId}.${rule.id}.dimensions.schema`);
      assertString(rule.dimensions.contributor, `${serviceId}.${rule.id}.dimensions.contributor`);
      assertNumber(rule.minTps, `${serviceId}.${rule.id}.minTps`);
      assertNumber(rule.maxTps, `${serviceId}.${rule.id}.maxTps`);
      assertNumber(rule.priority, `${serviceId}.${rule.id}.priority`);
      if (typeof rule.enabled !== "boolean") {
        throw new Error(`${serviceId}.${rule.id}.enabled must be a boolean`);
      }
    }
  }

  return snapshot;
}

export function parseTrafficSnapshot(input: unknown): TrafficSnapshot {
  if (!isRecord(input)) {
    throw new Error("traffic snapshot must be an object");
  }
  const snapshot = input as unknown as TrafficSnapshot;
  if (snapshot.snapshotKind !== "traffic") {
    throw new Error("expected traffic snapshot");
  }
  if (!isRecord(snapshot.nodes)) {
    throw new Error("traffic.nodes must be an object");
  }
  assertArray(snapshot.timeSeries, "traffic.timeSeries");
  assertArray(snapshot.alerts, "traffic.alerts");
  assertNumber(snapshot.summary.totalIngestTps, "traffic.summary.totalIngestTps");
  return snapshot;
}
