import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Gauge,
  GitBranch,
  RefreshCcw,
  Search,
  ServerCog,
  ShieldAlert,
  SlidersHorizontal,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { loadDashboardData } from "./lib/configLoader";
import { getNodeCapacity, getNodeStatus } from "./lib/capacity";
import { formatAge, formatNumber, formatPercent, formatTps } from "./lib/format";
import {
  compareThrottleSnapshots,
  getApplicableRules,
  getRulesForService,
  getSupportedThrottleTypes,
  hasThrottleDriftForService
} from "./lib/throttles";
import type {
  ArchitectureNode,
  DashboardData,
  HealthStatus,
  NodeTrafficMetrics,
  ThrottleRule,
  TrafficPoint
} from "./types";

const STATUS_LABELS: Record<HealthStatus, string> = {
  normal: "Normal",
  warning: "Warning",
  critical: "Critical"
};

const STATUS_ORDER: Record<HealthStatus, number> = {
  normal: 0,
  warning: 1,
  critical: 2
};

const NODE_ICONS: Record<ArchitectureNode["type"], LucideIcon> = {
  producer: Boxes,
  service: ServerCog,
  router: GitBranch,
  kinesisStream: Activity,
  slowLane: ShieldAlert,
  openSearchCluster: Database,
  api: Cloud
};

function statusClass(status: HealthStatus): string {
  return `status-${status}`;
}

function getMetricTps(metrics: NodeTrafficMetrics | undefined): number | undefined {
  return (
    metrics?.writeTps ??
    metrics?.processingTps ??
    metrics?.indexTps ??
    metrics?.searchTps ??
    metrics?.tps
  );
}

function getTopKey(values: Record<string, number> | undefined): string {
  if (!values || Object.keys(values).length === 0) {
    return "*";
  }
  return Object.entries(values).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "*";
}

function pickWorstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (worst, status) => (STATUS_ORDER[status] > STATUS_ORDER[worst] ? status : worst),
    "normal"
  );
}

function buildSchemaRows(metrics: NodeTrafficMetrics | undefined): { name: string; tps: number }[] {
  return Object.entries(metrics?.schemaTps ?? {})
    .map(([name, tps]) => ({ name, tps }))
    .sort((left, right) => right.tps - left.tps)
    .slice(0, 5);
}

function KpiCard({
  title,
  value,
  unit,
  tone,
  dataKey,
  points
}: {
  title: string;
  value: number;
  unit: string;
  tone: string;
  dataKey: keyof TrafficPoint;
  points: TrafficPoint[];
}) {
  return (
    <section className={`kpi-card tone-${tone}`}>
      <div>
        <p>{title}</p>
        <strong>{formatNumber(value)}</strong>
        <span>{unit}</span>
      </div>
      <div className="sparkline" aria-hidden="true">
        <ResponsiveContainer width="100%" height={56}>
          <AreaChart data={points}>
            <Area type="monotone" dataKey={dataKey} stroke="currentColor" fill="currentColor" fillOpacity={0.16} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CapacityBar({ utilization, status }: { utilization: number; status: HealthStatus }) {
  return (
    <div className="capacity-bar" aria-label={`${Math.round(utilization * 100)} percent utilized`}>
      <span className={statusClass(status)} style={{ width: `${Math.min(utilization * 100, 100)}%` }} />
    </div>
  );
}

function NodeCard({
  node,
  data,
  selected,
  onSelect
}: {
  node: ArchitectureNode;
  data: DashboardData;
  selected: boolean;
  onSelect: (node: ArchitectureNode) => void;
}) {
  const metrics = data.traffic.nodes[node.id];
  const hasDrift = hasThrottleDriftForService(data.desiredThrottles, data.liveThrottles, node);
  const status = getNodeStatus(node, metrics, data.architecture, hasDrift);
  const capacity = getNodeCapacity(node, metrics, data.architecture);
  const Icon = NODE_ICONS[node.type];
  const throttleCount = getRulesForService(
    data.liveThrottles,
    node.id,
    getSupportedThrottleTypes(node)
  ).length;
  const targetEdges = data.architecture.edges.filter((edge) => edge.from === node.id);

  return (
    <button
      type="button"
      className={`node-card ${node.type} ${statusClass(status)} ${selected ? "selected" : ""}`}
      onClick={() => onSelect(node)}
      aria-label={`Inspect ${node.name}`}
    >
      <span className="node-card-header">
        <span className="node-icon">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span>
          <strong>{node.name}</strong>
          <small>{node.type.replace(/([A-Z])/g, " $1")}</small>
        </span>
      </span>

      <span className="node-metrics">
        <span>{formatTps(getMetricTps(metrics))}</span>
        <span>{formatPercent(metrics?.successRate, 1)} success</span>
        {node.kinesis ? <span>{node.kinesis.shardCount} shards</span> : null}
        {metrics?.backlog !== undefined ? <span>{formatNumber(metrics.backlog)} backlog</span> : null}
      </span>

      {capacity ? <CapacityBar utilization={capacity.utilization} status={capacity.status} /> : null}

      <span className="node-footer">
        <span>{throttleCount} live throttles</span>
        {hasDrift ? <span className="drift-pill">drift</span> : <span>{STATUS_LABELS[status]}</span>}
      </span>

      {targetEdges.length > 0 ? (
        <span className="edge-list">
          {targetEdges.slice(0, 3).map((edge) => (
            <span key={`${edge.from}-${edge.to}`} className={edge.mode === "slowLane" ? "slow-edge" : ""}>
              {edge.label}
              <ChevronRight size={12} aria-hidden="true" />
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function ArchitectureFlow({
  data,
  selectedNodeId,
  onSelect
}: {
  data: DashboardData;
  selectedNodeId: string | undefined;
  onSelect: (node: ArchitectureNode) => void;
}) {
  const tiers = [...data.architecture.tiers].sort((left, right) => left.order - right.order);
  const nodesByTier = new Map<string, ArchitectureNode[]>();
  for (const node of data.architecture.nodes) {
    const nodes = nodesByTier.get(node.tier) ?? [];
    nodes.push(node);
    nodesByTier.set(node.tier, nodes);
  }

  return (
    <section className="panel architecture-panel">
      <div className="section-heading">
        <div>
          <p>Architecture Flow</p>
          <h2>Traffic, capacity, and throttle trace</h2>
        </div>
        <span>{data.architecture.nodes.length} systems</span>
      </div>
      <div className="tier-grid">
        {tiers.map((tier) => (
          <div key={tier.id} className="tier-column">
            <div className="tier-heading">
              <span>{tier.order}</span>
              <strong>{tier.name}</strong>
            </div>
            <div className="tier-nodes">
              {(nodesByTier.get(tier.id) ?? []).map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  data={data}
                  selected={selectedNodeId === node.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapacityPanel({ data }: { data: DashboardData }) {
  const capacityRows = data.architecture.nodes
    .map((node) => ({
      node,
      metrics: data.traffic.nodes[node.id],
      capacity: getNodeCapacity(node, data.traffic.nodes[node.id], data.architecture),
      drift: hasThrottleDriftForService(data.desiredThrottles, data.liveThrottles, node)
    }))
    .filter((row) => row.capacity)
    .sort((left, right) => (right.capacity?.utilization ?? 0) - (left.capacity?.utilization ?? 0))
    .slice(0, 8);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>Capacity Watch</p>
          <h2>Highest utilization surfaces</h2>
        </div>
        <Gauge size={20} aria-hidden="true" />
      </div>
      <div className="capacity-list">
        {capacityRows.map(({ node, capacity, drift }) =>
          capacity ? (
            <div key={node.id} className="capacity-row">
              <div>
                <strong>{node.name}</strong>
                <span>{capacity.label}</span>
              </div>
              <div className="capacity-row-meter">
                <span>{formatPercent(capacity.utilization * 100, 0)}</span>
                <CapacityBar utilization={capacity.utilization} status={drift ? "critical" : capacity.status} />
              </div>
            </div>
          ) : null
        )}
      </div>
    </section>
  );
}

function TrafficCharts({ data }: { data: DashboardData }) {
  return (
    <div className="chart-grid">
      <section className="panel chart-panel">
        <div className="section-heading">
          <div>
            <p>Traffic Over Time</p>
            <h2>TPS by pipeline layer</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.traffic.timeSeries}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="time" stroke="#8ea4b8" tickLine={false} axisLine={false} />
            <YAxis stroke="#8ea4b8" tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <Tooltip contentStyle={{ background: "#07131f", border: "1px solid #264057", color: "#e5f0fb" }} />
            <Line dataKey="ingest" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line dataKey="processing" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line dataKey="aggregate" stroke="#a855f7" strokeWidth={2} dot={false} />
            <Line dataKey="router" stroke="#f97316" strokeWidth={2} dot={false} />
            <Line dataKey="hotIndexing" stroke="#2dd4bf" strokeWidth={2} dot={false} />
            <Line dataKey="coldIndexing" stroke="#60a5fa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <section className="panel chart-panel">
        <div className="section-heading">
          <div>
            <p>Throttle And Backlog</p>
            <h2>Slow-lane pressure</h2>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={data.traffic.timeSeries}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="time" stroke="#8ea4b8" tickLine={false} axisLine={false} />
            <YAxis stroke="#8ea4b8" tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k`} />
            <Tooltip contentStyle={{ background: "#07131f", border: "1px solid #264057", color: "#e5f0fb" }} />
            <Area dataKey="slowLaneBacklog" stroke="#f97316" fill="#f97316" fillOpacity={0.18} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </section>
    </div>
  );
}

function HealthPanel({ data }: { data: DashboardData }) {
  const statuses = data.architecture.nodes.map((node) =>
    getNodeStatus(
      node,
      data.traffic.nodes[node.id],
      data.architecture,
      hasThrottleDriftForService(data.desiredThrottles, data.liveThrottles, node)
    )
  );
  const critical = statuses.filter((status) => status === "critical").length;
  const warning = statuses.filter((status) => status === "warning").length;
  const normal = statuses.filter((status) => status === "normal").length;
  const overallStatus = pickWorstStatus(statuses);

  return (
    <section className="panel health-panel">
      <div className="section-heading">
        <div>
          <p>System Health</p>
          <h2>{STATUS_LABELS[overallStatus]}</h2>
        </div>
        <CheckCircle2 className={statusClass(overallStatus)} size={22} aria-hidden="true" />
      </div>
      <div className="health-dial">
        <span>{formatPercent(data.traffic.summary.successRate, 2)}</span>
        <small>End-to-end success</small>
      </div>
      <div className="health-counts">
        <span><strong>{normal}</strong> Normal</span>
        <span><strong>{warning}</strong> Warning</span>
        <span><strong>{critical}</strong> Critical</span>
      </div>
    </section>
  );
}

function AlertsPanel({ data }: { data: DashboardData }) {
  return (
    <section className="panel alerts-panel">
      <div className="section-heading">
        <div>
          <p>Live Alerts</p>
          <h2>Config and traffic signals</h2>
        </div>
        <AlertTriangle size={20} aria-hidden="true" />
      </div>
      <div className="alert-list">
        {data.traffic.alerts.map((alert) => (
          <article key={alert.id} className={`alert-item severity-${alert.severity}`}>
            <span>{alert.time}</span>
            <strong>{alert.severity}</strong>
            <p>{alert.message}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RuleCard({ rule, title }: { rule: ThrottleRule | undefined; title: string }) {
  if (!rule) {
    return (
      <div className="rule-card empty">
        <strong>{title}</strong>
        <p>No rule in this snapshot.</p>
      </div>
    );
  }

  return (
    <div className="rule-card">
      <strong>{title}</strong>
      <dl>
        <div>
          <dt>Min</dt>
          <dd>{formatTps(rule.minTps)}</dd>
        </div>
        <div>
          <dt>Max</dt>
          <dd>{formatTps(rule.maxTps)}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{rule.priority}</dd>
        </div>
        <div>
          <dt>Enabled</dt>
          <dd>{rule.enabled ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>{rule.dimensions.schema}</dd>
        </div>
        <div>
          <dt>Contributor</dt>
          <dd>{rule.dimensions.contributor}</dd>
        </div>
      </dl>
      {rule.notes ? <p>{rule.notes}</p> : null}
    </div>
  );
}

function InspectionDrawer({
  data,
  node,
  onClose
}: {
  data: DashboardData;
  node: ArchitectureNode | undefined;
  onClose: () => void;
}) {
  const supportedTypes = getSupportedThrottleTypes(node);
  const metrics = node ? data.traffic.nodes[node.id] : undefined;
  const desiredRules = node ? getRulesForService(data.desiredThrottles, node.id, supportedTypes) : [];
  const liveRules = node ? getRulesForService(data.liveThrottles, node.id, supportedTypes) : [];
  const comparisons = compareThrottleSnapshots(desiredRules, liveRules);
  const capacity = node ? getNodeCapacity(node, metrics, data.architecture) : undefined;
  const schema = getTopKey(metrics?.schemaTps);
  const contributor = getTopKey(metrics?.contributorTps);
  const desiredApplicable = getApplicableRules(desiredRules, { schema, contributor });
  const liveApplicable = getApplicableRules(liveRules, { schema, contributor });
  const schemaRows = buildSchemaRows(metrics);

  return (
    <aside className={`drawer ${node ? "open" : ""}`} aria-hidden={!node} aria-label="Throttle inspection drawer">
      {node ? (
        <>
          <div className="drawer-header">
            <div>
              <p>Throttle Inspection</p>
              <h2>{node.name}</h2>
              <span>{node.summary}</span>
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close inspection drawer">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <section className="drawer-section">
            <h3>Supported throttle types</h3>
            <div className="chip-row">
              {supportedTypes.length > 0 ? supportedTypes.map((type) => <span key={type}>{type}</span>) : <span>None configured</span>}
            </div>
          </section>

          <section className="drawer-section metrics-section">
            <h3>Traffic metrics</h3>
            <div className="metric-grid">
              <span><strong>{formatTps(getMetricTps(metrics))}</strong> Observed</span>
              <span><strong>{formatPercent(metrics?.throttlePercent, 2)}</strong> Throttled</span>
              <span><strong>{metrics?.latencyP95Ms ?? "n/a"} ms</strong> p95 latency</span>
              <span><strong>{formatPercent(metrics?.successRate, 1)}</strong> Success</span>
              {metrics?.backlog !== undefined ? <span><strong>{formatNumber(metrics.backlog)}</strong> Backlog</span> : null}
              {metrics?.oldestAgeSeconds !== undefined ? <span><strong>{formatAge(metrics.oldestAgeSeconds)}</strong> Oldest message</span> : null}
            </div>
            {capacity ? (
              <div className="drawer-capacity">
                <div>
                  <strong>{capacity.label}</strong>
                  <span>{capacity.detail}</span>
                </div>
                <CapacityBar utilization={capacity.utilization} status={capacity.status} />
                <small>{formatTps(capacity.headroomTps)} estimated headroom</small>
              </div>
            ) : null}
          </section>

          <section className="drawer-section">
            <h3>Desired vs live config</h3>
            {comparisons.length === 0 ? (
              <p className="empty-state">No throttle rules apply to this node.</p>
            ) : (
              <div className="comparison-list">
                {comparisons.map((comparison) => (
                  <article key={comparison.id} className={`comparison-item ${comparison.status}`}>
                    <div className="comparison-heading">
                      <div>
                        <strong>{comparison.desired?.name ?? comparison.live?.name ?? comparison.id}</strong>
                        <span>{comparison.desired?.throttleType ?? comparison.live?.throttleType}</span>
                      </div>
                      <span>{comparison.status === "match" ? "match" : `drift: ${comparison.driftFields.join(", ")}`}</span>
                    </div>
                    <div className="rule-compare-grid">
                      <RuleCard title="Desired" rule={comparison.desired} />
                      <RuleCard title="Live Applied" rule={comparison.live} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="drawer-section">
            <h3>Rule trace for current top traffic</h3>
            <p className="trace-query">schema={schema} contributor={contributor}</p>
            <div className="trace-grid">
              <div>
                <strong>Desired order</strong>
                {desiredApplicable.length > 0 ? (
                  desiredApplicable.map((rule) => (
                    <span key={rule.id}>{rule.priority} - {rule.name} ({formatTps(rule.maxTps)})</span>
                  ))
                ) : (
                  <span>No enabled matching rule</span>
                )}
              </div>
              <div>
                <strong>Live order</strong>
                {liveApplicable.length > 0 ? (
                  liveApplicable.map((rule) => (
                    <span key={rule.id}>{rule.priority} - {rule.name} ({formatTps(rule.maxTps)})</span>
                  ))
                ) : (
                  <span>No enabled matching rule</span>
                )}
              </div>
            </div>
          </section>

          {schemaRows.length > 0 ? (
            <section className="drawer-section">
              <h3>TPS by schema</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={schemaRows} layout="vertical" margin={{ left: 18, right: 10 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} stroke="#9fb3c8" />
                  <Tooltip contentStyle={{ background: "#07131f", border: "1px solid #264057", color: "#e5f0fb" }} />
                  <Bar dataKey="tps" radius={[0, 6, 6, 0]}>
                    {schemaRows.map((row, index) => (
                      <Cell key={row.name} fill={["#38bdf8", "#22c55e", "#f97316", "#a855f7", "#2dd4bf"][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

function Dashboard({ data, onRefresh, refreshing }: { data: DashboardData; onRefresh: () => void; refreshing: boolean }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(data.architecture.nodes[9]?.id ?? data.architecture.nodes[0]?.id);
  const selectedNode = data.architecture.nodes.find((node) => node.id === selectedNodeId);
  const lastUpdated = new Date(data.traffic.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  useEffect(() => {
    if (selectedNodeId && !data.architecture.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(data.architecture.nodes[0]?.id);
    }
  }, [data.architecture.nodes, selectedNodeId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="live-pill">LIVE CONFIG SNAPSHOT</span>
          <h1 data-testid="dashboard-title">Data Pipeline Traffic Visualizer</h1>
          <p>Last updated: {lastUpdated} · {data.traffic.window}</p>
        </div>
        <button
          type="button"
          className="refresh-button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh configuration snapshots"
        >
          <RefreshCcw size={18} aria-hidden="true" className={refreshing ? "spin" : ""} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      <main className="dashboard-layout">
        <section className="kpi-grid" aria-label="Pipeline KPIs">
          <KpiCard title="Total Ingest TPS" value={data.traffic.summary.totalIngestTps} unit="events/sec" tone="blue" dataKey="ingest" points={data.traffic.timeSeries} />
          <KpiCard title="Processing TPS" value={data.traffic.summary.totalProcessingTps} unit="events/sec" tone="green" dataKey="processing" points={data.traffic.timeSeries} />
          <KpiCard title="Aggregate Stream TPS" value={data.traffic.summary.aggregateStreamTps} unit="events/sec" tone="purple" dataKey="aggregate" points={data.traffic.timeSeries} />
          <KpiCard title="Router TPS" value={data.traffic.summary.routerTps} unit="events/sec" tone="orange" dataKey="router" points={data.traffic.timeSeries} />
          <KpiCard title="Indexing TPS (Hot)" value={data.traffic.summary.hotIndexingTps} unit="docs/sec" tone="cyan" dataKey="hotIndexing" points={data.traffic.timeSeries} />
          <KpiCard title="Indexing TPS (Cold)" value={data.traffic.summary.coldIndexingTps} unit="docs/sec" tone="slate" dataKey="coldIndexing" points={data.traffic.timeSeries} />
          <KpiCard title="API Search TPS" value={data.traffic.summary.apiSearchTps} unit="req/sec" tone="teal" dataKey="apiSearch" points={data.traffic.timeSeries} />
          <section className="kpi-card success-card">
            <p>End-to-End Success Rate</p>
            <strong>{formatPercent(data.traffic.summary.successRate, 2)}</strong>
            <span>success</span>
            <CheckCircle2 size={30} aria-hidden="true" />
          </section>
        </section>

        <ArchitectureFlow data={data} selectedNodeId={selectedNodeId} onSelect={(node) => setSelectedNodeId(node.id)} />

        <div className="lower-grid">
          <TrafficCharts data={data} />
          <CapacityPanel data={data} />
          <HealthPanel data={data} />
          <AlertsPanel data={data} />
        </div>
      </main>

      <InspectionDrawer data={data} node={selectedNode} onClose={() => setSelectedNodeId(undefined)} />
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    setError(undefined);
    try {
      setData(await loadDashboardData());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown dashboard load failure");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const shell = useMemo(() => {
    if (error) {
      return (
        <div className="load-state error-state">
          <Search size={28} aria-hidden="true" />
          <h1>Unable to load dashboard snapshots</h1>
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      );
    }

    if (!data) {
      return (
        <div className="load-state">
          <SlidersHorizontal size={28} aria-hidden="true" />
          <h1>Loading traffic and throttle snapshots</h1>
        </div>
      );
    }

    return <Dashboard data={data} onRefresh={() => void load()} refreshing={refreshing} />;
  }, [data, error, refreshing]);

  return shell;
}
