export type NodeType =
  | "producer"
  | "service"
  | "router"
  | "kinesisStream"
  | "slowLane"
  | "openSearchCluster"
  | "api";

export type ThrottleType =
  | "schema"
  | "contributor"
  | "schemaContributor"
  | "priorityLane";

export type HealthStatus = "normal" | "warning" | "critical";

export interface KinesisDefaults {
  writeRecordsPerShardPerSecond: number;
  writeMbPerShardPerSecond: number;
  readMbPerShardPerSecond: number;
}

export interface Tier {
  id: string;
  name: string;
  order: number;
}

export interface ArchitectureNode {
  id: string;
  name: string;
  type: NodeType;
  tier: string;
  summary: string;
  replicas?: number;
  throttleTypes?: ThrottleType[];
  schemas?: string[];
  contributors?: string[];
  kinesis?: {
    shardCount: number;
    consumerCount?: number;
    writeRecordsPerShardPerSecond?: number;
    writeMbPerShardPerSecond?: number;
    readMbPerShardPerSecond?: number;
  };
  capacity?: {
    maxTps: number;
    instances?: number;
    workersPerInstance?: number;
  };
  queue?: {
    queueCount: number;
    maxBacklog: number;
    maxAgeSeconds: number;
  };
  cluster?: {
    nodeCount: number;
    maxIndexTps: number;
    maxSearchTps: number;
  };
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  label: string;
  mode?: "slowLane";
}

export interface ArchitectureConfig {
  version: number;
  updatedAt: string;
  kinesisDefaults: KinesisDefaults;
  tiers: Tier[];
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

export interface ThrottleRule {
  id: string;
  name: string;
  throttleType: ThrottleType;
  dimensions: {
    schema: string;
    contributor: string;
  };
  minTps: number;
  maxTps: number;
  priority: number;
  enabled: boolean;
  notes?: string;
}

export interface ThrottleServiceConfig {
  updatedAt: string;
  rules: ThrottleRule[];
}

export interface ThrottleSnapshot {
  version: number;
  snapshotKind: "desired" | "live";
  source: string;
  updatedAt: string;
  services: Record<string, ThrottleServiceConfig>;
}

export interface NodeTrafficMetrics {
  tps?: number;
  processingTps?: number;
  writeTps?: number;
  readTps?: number;
  indexTps?: number;
  searchTps?: number;
  successRate?: number;
  latencyP95Ms?: number;
  throttlePercent?: number;
  iteratorAgeMs?: number;
  backlog?: number;
  oldestAgeSeconds?: number;
  cpuPercent?: number;
  heapPercent?: number;
  documentsMillions?: number;
  schemaTps?: Record<string, number>;
  contributorTps?: Record<string, number>;
}

export interface TrafficSummary {
  totalIngestTps: number;
  totalProcessingTps: number;
  aggregateStreamTps: number;
  routerTps: number;
  hotIndexingTps: number;
  coldIndexingTps: number;
  apiSearchTps: number;
  successRate: number;
}

export interface TrafficPoint {
  time: string;
  ingest: number;
  processing: number;
  aggregate: number;
  router: number;
  hotIndexing: number;
  coldIndexing: number;
  apiSearch: number;
  throttle: number;
  slowLaneBacklog: number;
}

export interface TrafficAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  time: string;
  message: string;
  nodeId: string;
}

export interface TrafficSnapshot {
  version: number;
  snapshotKind: "traffic";
  updatedAt: string;
  window: string;
  summary: TrafficSummary;
  nodes: Record<string, NodeTrafficMetrics>;
  timeSeries: TrafficPoint[];
  alerts: TrafficAlert[];
}

export interface DashboardData {
  architecture: ArchitectureConfig;
  desiredThrottles: ThrottleSnapshot;
  liveThrottles: ThrottleSnapshot;
  traffic: TrafficSnapshot;
}
