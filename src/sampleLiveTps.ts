import type { ArchitectureOverlays, EdgeDecorator, NodeDecorator } from "./zod";

export const SAMPLE_LIVE_TPS_SOURCE = "sample-live-tps";

interface LiveTpsSeries {
  id: string;
  title: string;
  baseTps: number;
  swing: number;
  phase: number;
  period: number;
}

interface StreamTpsSeries extends LiveTpsSeries {
  nodeId: string;
}

interface EdgeTpsSeries extends LiveTpsSeries {
  edgeId: string;
  tone?: EdgeDecorator["tone"];
}

export interface SampleLiveTpsOptions {
  tick?: number;
}

const STREAM_TPS_SERIES: StreamTpsSeries[] = [
  {
    id: "live-tps-orders-ingestion-stream",
    nodeId: "use1.ingestion.orders_stream",
    title: "Live TPS - Orders Kinesis",
    baseTps: 1250,
    swing: 180,
    phase: 0,
    period: 7
  },
  {
    id: "live-tps-mobile-events-stream",
    nodeId: "use1.ingestion.mobile_events_stream",
    title: "Live TPS - Mobile Events Kinesis",
    baseTps: 940,
    swing: 150,
    phase: 2,
    period: 8
  },
  {
    id: "live-tps-partner-events-stream",
    nodeId: "use1.ingestion.partner_events_stream",
    title: "Live TPS - Partner events",
    baseTps: 430,
    swing: 85,
    phase: 4,
    period: 6
  },
  {
    id: "live-tps-inventory-updates-stream",
    nodeId: "use1.ingestion.inventory_updates_stream",
    title: "Live TPS - Inventory updates",
    baseTps: 610,
    swing: 110,
    phase: 1,
    period: 9
  },
  {
    id: "live-tps-aggregate-stream",
    nodeId: "use1.aggregate.stream",
    title: "Live TPS - Enriched Events Kinesis",
    baseTps: 2760,
    swing: 360,
    phase: 3,
    period: 10
  },
  {
    id: "live-tps-hot-products-stream",
    nodeId: "use1.hot.stream.products",
    title: "Live TPS - Products Index Kinesis",
    baseTps: 1530,
    swing: 220,
    phase: 5,
    period: 8
  },
  {
    id: "live-tps-hot-orders-stream",
    nodeId: "use1.hot.stream.orders",
    title: "Live TPS - Orders Index Kinesis",
    baseTps: 1180,
    swing: 190,
    phase: 2,
    period: 7
  },
  {
    id: "live-tps-partner-stream",
    nodeId: "use1.partner.stream",
    title: "Live TPS - Partner stream",
    baseTps: 380,
    swing: 70,
    phase: 6,
    period: 9
  }
];

const EDGE_TPS_SERIES: EdgeTpsSeries[] = [
  {
    id: "live-tps-edge-web-orders-ingestion",
    edgeId: "edge.use1.sources.web.to.orders.ingestion",
    title: "Live TPS - Web orders publish",
    baseTps: 1250,
    swing: 180,
    phase: 0,
    period: 7,
    tone: "primary"
  },
  {
    id: "live-tps-edge-orders-consume",
    edgeId: "edge.use1.orders.ingestion.to.orders.processor",
    title: "Live TPS - Orders Kinesis consume",
    baseTps: 1210,
    swing: 170,
    phase: 1,
    period: 7,
    tone: "primary"
  },
  {
    id: "live-tps-edge-mobile-ingestion",
    edgeId: "edge.use1.sources.mobile.to.mobile.ingestion",
    title: "Live TPS - Mobile events publish",
    baseTps: 940,
    swing: 150,
    phase: 2,
    period: 8,
    tone: "primary"
  },
  {
    id: "live-tps-edge-mobile-context-consume",
    edgeId: "edge.use1.mobile.ingestion.to.orders.processor",
    title: "Live TPS - Mobile context consume",
    baseTps: 880,
    swing: 140,
    phase: 3,
    period: 8,
    tone: "primary"
  },
  {
    id: "live-tps-edge-partner-ingestion",
    edgeId: "edge.use1.sources.partner.to.partner.ingestion",
    title: "Live TPS - Partner events publish",
    baseTps: 430,
    swing: 85,
    phase: 4,
    period: 6,
    tone: "secondary"
  },
  {
    id: "live-tps-edge-inventory-ingestion",
    edgeId: "edge.use1.sources.pos.to.inventory.ingestion",
    title: "Live TPS - Inventory updates publish",
    baseTps: 610,
    swing: 110,
    phase: 1,
    period: 9,
    tone: "primary"
  },
  {
    id: "live-tps-edge-orders-aggregate-publish",
    edgeId: "edge.use1.orders.processor.to.aggregate",
    title: "Live TPS - Enriched orders publish",
    baseTps: 1180,
    swing: 165,
    phase: 2,
    period: 9,
    tone: "primary"
  },
  {
    id: "live-tps-edge-aggregate-hot-router",
    edgeId: "edge.use1.aggregate.to.hot.router",
    title: "Live TPS - Hot feed",
    baseTps: 2760,
    swing: 360,
    phase: 3,
    period: 10,
    tone: "primary"
  },
  {
    id: "live-tps-edge-products-hot-route",
    edgeId: "edge.use1.hot.router.to.products.stream",
    title: "Live TPS - Products hot route",
    baseTps: 1530,
    swing: 220,
    phase: 5,
    period: 8,
    tone: "primary"
  },
  {
    id: "live-tps-edge-orders-hot-route",
    edgeId: "edge.use1.hot.router.to.orders.stream",
    title: "Live TPS - Orders hot route",
    baseTps: 1180,
    swing: 190,
    phase: 2,
    period: 7,
    tone: "primary"
  },
  {
    id: "live-tps-edge-products-index-consume",
    edgeId: "edge.use1.hot.products.stream.to.indexers",
    title: "Live TPS - Products index consume",
    baseTps: 1490,
    swing: 210,
    phase: 6,
    period: 8,
    tone: "primary"
  },
  {
    id: "live-tps-edge-orders-index-consume",
    edgeId: "edge.use1.hot.orders.stream.to.indexers",
    title: "Live TPS - Orders index consume",
    baseTps: 1140,
    swing: 180,
    phase: 3,
    period: 7,
    tone: "primary"
  },
  {
    id: "live-tps-edge-products-opensearch-index",
    edgeId: "edge.use1.hot.indexers.to.products.cluster",
    title: "Live TPS - Products OpenSearch index",
    baseTps: 1470,
    swing: 205,
    phase: 7,
    period: 8,
    tone: "primary"
  },
  {
    id: "live-tps-edge-orders-opensearch-index",
    edgeId: "edge.use1.hot.indexers.to.orders.cluster",
    title: "Live TPS - Orders OpenSearch index",
    baseTps: 1120,
    swing: 175,
    phase: 4,
    period: 7,
    tone: "primary"
  },
  {
    id: "live-tps-edge-products-query",
    edgeId: "edge.use1.hot.products.cluster.to.api",
    title: "Live TPS - Products search reads",
    baseTps: 820,
    swing: 130,
    phase: 1,
    period: 6,
    tone: "read"
  },
  {
    id: "live-tps-edge-orders-query",
    edgeId: "edge.use1.hot.orders.cluster.to.api",
    title: "Live TPS - Orders search reads",
    baseTps: 680,
    swing: 105,
    phase: 5,
    period: 6,
    tone: "read"
  },
  {
    id: "live-tps-edge-partner-local-route",
    edgeId: "edge.use1.hot.router.to.partner.stream",
    title: "Live TPS - Partner local route",
    baseTps: 380,
    swing: 70,
    phase: 6,
    period: 9,
    tone: "cross"
  }
];

const LIVE_NODE_DECORATOR_IDS = new Set(STREAM_TPS_SERIES.map((series) => series.id));
const LIVE_EDGE_DECORATOR_IDS = new Set(EDGE_TPS_SERIES.map((series) => series.id));

function liveTpsValue(series: LiveTpsSeries, tick: number): number {
  const wave = Math.sin(((tick + series.phase) / series.period) * Math.PI * 2);
  const pulse = ((tick + series.phase) % 4) * 17;
  return Math.max(1, Math.round(series.baseTps + wave * series.swing + pulse));
}

function formatTps(value: number): string {
  return value.toLocaleString("en-US");
}

function liveThickness(value: number, baseTps: number): number {
  const ratio = Math.min(Math.max(value / baseTps, 0.75), 1.25);
  return Number((2.6 + (ratio - 0.75) * 3.2).toFixed(2));
}

function liveNodeDecorator(series: StreamTpsSeries, tick: number): NodeDecorator {
  const tps = liveTpsValue(series, tick);

  return {
    id: series.id,
    node_id: series.nodeId,
    title: series.title,
    metrics: [{ label: "TPS", value: formatTps(tps) }],
    badges: ["live"],
    notes: []
  };
}

function liveEdgeDecorator(series: EdgeTpsSeries, tick: number): EdgeDecorator {
  const tps = liveTpsValue(series, tick);
  const formattedTps = `${formatTps(tps)} TPS`;

  return {
    id: series.id,
    edge_id: series.edgeId,
    title: series.title,
    metric_label: formattedTps,
    badges: ["live"],
    metrics: [{ label: "TPS", value: formatTps(tps) }],
    tone: series.tone,
    thickness: liveThickness(tps, series.baseTps)
  };
}

export function buildSampleLiveTpsOverlays(
  baseOverlays: ArchitectureOverlays,
  options: SampleLiveTpsOptions = {}
): ArchitectureOverlays {
  const tick = options.tick ?? 0;

  return {
    node_decorators: [
      ...baseOverlays.node_decorators.filter((decorator) => !LIVE_NODE_DECORATOR_IDS.has(decorator.id)),
      ...STREAM_TPS_SERIES.map((series) => liveNodeDecorator(series, tick))
    ],
    edge_decorators: [
      ...baseOverlays.edge_decorators.filter((decorator) => !LIVE_EDGE_DECORATOR_IDS.has(decorator.id)),
      ...EDGE_TPS_SERIES.map((series) => liveEdgeDecorator(series, tick))
    ],
    route_decorators: [...baseOverlays.route_decorators],
    controls: [...baseOverlays.controls]
  };
}
