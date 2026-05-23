import type {
  ArchitectureConfig,
  ArchitectureNode,
  HealthStatus,
  KinesisDefaults,
  NodeTrafficMetrics
} from "../types";

export interface CapacityResult {
  label: string;
  observedTps: number;
  capacityTps: number;
  utilization: number;
  headroomTps: number;
  status: HealthStatus;
  detail: string;
}

function statusFromUtilization(utilization: number): HealthStatus {
  if (utilization >= 0.9) {
    return "critical";
  }
  if (utilization >= 0.7) {
    return "warning";
  }
  return "normal";
}

function clampUtilization(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function calculateUtilization(observed: number, capacity: number): number {
  if (capacity <= 0) {
    return 1;
  }
  return clampUtilization(observed / capacity);
}

export function getKinesisWriteCapacity(node: ArchitectureNode, defaults: KinesisDefaults): number {
  if (!node.kinesis) {
    return 0;
  }

  const recordsPerShard =
    node.kinesis.writeRecordsPerShardPerSecond ?? defaults.writeRecordsPerShardPerSecond;
  return node.kinesis.shardCount * recordsPerShard;
}

export function getKinesisReadMbCapacity(node: ArchitectureNode, defaults: KinesisDefaults): number {
  if (!node.kinesis) {
    return 0;
  }

  const readMbPerShard = node.kinesis.readMbPerShardPerSecond ?? defaults.readMbPerShardPerSecond;
  return node.kinesis.shardCount * readMbPerShard;
}

export function getNodeCapacity(
  node: ArchitectureNode,
  metrics: NodeTrafficMetrics | undefined,
  architecture: ArchitectureConfig
): CapacityResult | undefined {
  const observedTps =
    metrics?.writeTps ??
    metrics?.processingTps ??
    metrics?.indexTps ??
    metrics?.searchTps ??
    metrics?.tps ??
    0;

  if (node.type === "kinesisStream" && node.kinesis) {
    const capacityTps = getKinesisWriteCapacity(node, architecture.kinesisDefaults);
    const utilization = calculateUtilization(observedTps, capacityTps);
    return {
      label: "Shard write capacity",
      observedTps,
      capacityTps,
      utilization,
      headroomTps: Math.max(capacityTps - observedTps, 0),
      status: statusFromUtilization(utilization),
      detail: `${node.kinesis.shardCount} shards at ${node.kinesis.writeRecordsPerShardPerSecond ?? architecture.kinesisDefaults.writeRecordsPerShardPerSecond} records/sec`
    };
  }

  if ((node.type === "service" || node.type === "router" || node.type === "api") && node.capacity) {
    const capacityTps = node.capacity.maxTps;
    const utilization = calculateUtilization(observedTps, capacityTps);
    return {
      label: "Processing capacity",
      observedTps,
      capacityTps,
      utilization,
      headroomTps: Math.max(capacityTps - observedTps, 0),
      status: statusFromUtilization(utilization),
      detail: `${node.capacity.instances ?? node.replicas ?? 1} instances, ${node.capacity.workersPerInstance ?? 1} workers each`
    };
  }

  if (node.type === "slowLane" && node.queue) {
    const backlog = metrics?.backlog ?? 0;
    const utilization = calculateUtilization(backlog, node.queue.maxBacklog);
    const ageCritical = (metrics?.oldestAgeSeconds ?? 0) >= node.queue.maxAgeSeconds;
    const status = ageCritical ? "critical" : statusFromUtilization(utilization);
    return {
      label: "Queue backlog",
      observedTps: backlog,
      capacityTps: node.queue.maxBacklog,
      utilization,
      headroomTps: Math.max(node.queue.maxBacklog - backlog, 0),
      status,
      detail: `${node.queue.queueCount} queues, max age ${node.queue.maxAgeSeconds}s`
    };
  }

  if (node.type === "openSearchCluster" && node.cluster) {
    const capacityTps = node.cluster.maxIndexTps;
    const utilization = calculateUtilization(metrics?.indexTps ?? metrics?.tps ?? 0, capacityTps);
    const resourceCritical = (metrics?.cpuPercent ?? 0) >= 90 || (metrics?.heapPercent ?? 0) >= 90;
    const resourceWarning = (metrics?.cpuPercent ?? 0) >= 75 || (metrics?.heapPercent ?? 0) >= 75;
    return {
      label: "Index capacity",
      observedTps: metrics?.indexTps ?? metrics?.tps ?? 0,
      capacityTps,
      utilization,
      headroomTps: Math.max(capacityTps - (metrics?.indexTps ?? metrics?.tps ?? 0), 0),
      status: resourceCritical ? "critical" : resourceWarning ? "warning" : statusFromUtilization(utilization),
      detail: `${node.cluster.nodeCount} nodes, ${node.cluster.maxSearchTps} search tps cap`
    };
  }

  return undefined;
}

export function getNodeStatus(
  node: ArchitectureNode,
  metrics: NodeTrafficMetrics | undefined,
  architecture: ArchitectureConfig,
  hasThrottleDrift: boolean
): HealthStatus {
  if (hasThrottleDrift) {
    return "critical";
  }
  if ((metrics?.throttlePercent ?? 0) >= 0.1) {
    return "critical";
  }
  if ((metrics?.throttlePercent ?? 0) >= 0.05) {
    return "warning";
  }
  return getNodeCapacity(node, metrics, architecture)?.status ?? "normal";
}
