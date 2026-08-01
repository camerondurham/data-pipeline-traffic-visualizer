import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type GetMetricDataCommandInput,
  type GetMetricDataCommandOutput,
  type MetricDataQuery,
  type MetricDataResult
} from "@aws-sdk/client-cloudwatch";
import { parse } from "yaml";
import { validateArchitectureDocuments } from "./server/runtimeValidation";
import {
  overlayDecoratorIdForBinding,
  validateAwsMetricBindingsDocument,
  type AwsMetricBinding
} from "./awsMetricBindings";
import type {
  ArchitectureOverlays,
  EdgeDecorator,
  NodeDecorator,
  OverlayMetric,
  RouteDecorator
} from "./zod";

const AWS_CLOUDWATCH_OVERLAY_SOURCE = "aws-cloudwatch";
const AWS_CLOUDWATCH_STUB_OVERLAY_SOURCE = "aws-cloudwatch-stub";
const DEFAULT_DATA_DIR = resolve(process.cwd(), "data", "sample");
const DEFAULT_OVERLAY_API_URL = "http://127.0.0.1:4173/api/overlays/snapshot";
const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_LOOKBACK_SECONDS = 900;
const DEFAULT_MAX_QUERIES_PER_REQUEST = 500;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;

export type AwsOverlayStubMode = "off" | "ok" | "partial";

export interface AwsOverlayCollectorConfig {
  dataDir: string;
  bindingsPath: string;
  overlayApiUrl: string;
  intervalMs: number;
  lookbackSeconds: number;
  maxQueriesPerRequest: number;
  maxConcurrentRequests: number;
  source: string;
  stubMode: AwsOverlayStubMode;
}

interface AwsOverlayCollectorInputs {
  baseOverlays: ArchitectureOverlays;
  bindings: AwsMetricBinding[];
}

interface CloudWatchMetricBatchEntry {
  binding: AwsMetricBinding;
  queryId: string;
}

export interface CloudWatchMetricBatch {
  accountId?: string;
  region: string;
  entries: CloudWatchMetricBatchEntry[];
}

export interface CloudWatchMetricDataClient {
  send(command: GetMetricDataCommand): Promise<GetMetricDataCommandOutput>;
}

export type CloudWatchMetricDataClientFactory = (batch: CloudWatchMetricBatch) => CloudWatchMetricDataClient;

export interface MetricFetchResult {
  bindingId: string;
  status: "ok" | "missing" | "error";
  value?: number;
  timestamp?: string;
  message?: string;
}

export interface AwsOverlayCollectorSummary {
  bindingCount: number;
  okCount: number;
  missingCount: number;
  errorCount: number;
  generatedAt: string;
}

interface FetchCloudWatchMetricOptions {
  now?: Date;
  lookbackSeconds?: number;
  maxQueriesPerRequest?: number;
  maxConcurrentRequests?: number;
  clientFactory?: CloudWatchMetricDataClientFactory;
}

interface PostSnapshotOptions {
  overlayApiUrl: string;
  overlays: ArchitectureOverlays;
  source: string;
  generatedAt: string;
  fetchFn?: typeof fetch;
}

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").toLowerCase());
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readAwsOverlayStubMode(env: NodeJS.ProcessEnv): AwsOverlayStubMode {
  const mode = env.AWS_OVERLAY_STUB_MODE?.trim().toLowerCase();
  if (!mode) {
    return isEnabled(env.AWS_OVERLAY_STUB) ? "ok" : "off";
  }
  if (mode === "off" || mode === "ok" || mode === "partial") {
    return mode;
  }
  throw new Error("AWS_OVERLAY_STUB_MODE must be off, ok, or partial");
}

export function shouldRunOnceFromArgs(args: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return args.includes("--once") || isEnabled(env.AWS_OVERLAY_ONCE);
}

export function readAwsOverlayCollectorConfig(env: NodeJS.ProcessEnv = process.env): AwsOverlayCollectorConfig {
  const dataDir = resolve(env.ARCHITECTURE_DATA_DIR ?? DEFAULT_DATA_DIR);
  const stubMode = readAwsOverlayStubMode(env);

  return {
    dataDir,
    bindingsPath: resolve(env.ARCHITECTURE_METRIC_BINDINGS_PATH ?? resolve(dataDir, "metric-bindings.yaml")),
    overlayApiUrl: env.AWS_OVERLAY_API_URL ?? env.OVERLAY_API_URL ?? DEFAULT_OVERLAY_API_URL,
    intervalMs: readPositiveNumber(env.AWS_OVERLAY_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    lookbackSeconds: readPositiveNumber(env.AWS_OVERLAY_LOOKBACK_SECONDS, DEFAULT_LOOKBACK_SECONDS),
    maxQueriesPerRequest: Math.min(
      DEFAULT_MAX_QUERIES_PER_REQUEST,
      Math.floor(readPositiveNumber(env.AWS_OVERLAY_MAX_QUERIES_PER_REQUEST, DEFAULT_MAX_QUERIES_PER_REQUEST))
    ),
    maxConcurrentRequests: Math.max(
      1,
      Math.floor(readPositiveNumber(env.AWS_OVERLAY_MAX_CONCURRENT_REQUESTS, DEFAULT_MAX_CONCURRENT_REQUESTS))
    ),
    source:
      env.AWS_OVERLAY_SOURCE?.trim() ||
      (stubMode === "off" ? AWS_CLOUDWATCH_OVERLAY_SOURCE : AWS_CLOUDWATCH_STUB_OVERLAY_SOURCE),
    stubMode
  };
}

async function loadAwsOverlayCollectorInputs(config: AwsOverlayCollectorConfig): Promise<AwsOverlayCollectorInputs> {
  const [architectureYaml, overlaysYaml, bindingsYaml] = await Promise.all([
    readFile(resolve(config.dataDir, "architecture.yaml"), "utf8"),
    readFile(resolve(config.dataDir, "architecture-overlays.yaml"), "utf8"),
    readFile(config.bindingsPath, "utf8")
  ]);
  const validated = validateArchitectureDocuments(architectureYaml, overlaysYaml);
  const bindingsDocument = validateAwsMetricBindingsDocument(validated.manifest, validated.overlays, parse(bindingsYaml));

  return {
    baseOverlays: validated.overlays,
    bindings: bindingsDocument.metric_bindings
  };
}

export function buildCloudWatchMetricDataBatches(
  bindings: AwsMetricBinding[],
  maxQueriesPerRequest = DEFAULT_MAX_QUERIES_PER_REQUEST
): CloudWatchMetricBatch[] {
  const grouped = new Map<string, { accountId?: string; region: string; bindings: AwsMetricBinding[] }>();

  for (const binding of bindings) {
    const accountId = binding.cloudwatch.account_id;
    const region = binding.cloudwatch.region;
    const key = `${accountId ?? "monitoring"}:${region}`;
    const group = grouped.get(key) ?? { accountId, region, bindings: [] };
    group.bindings.push(binding);
    grouped.set(key, group);
  }

  const batches: CloudWatchMetricBatch[] = [];
  for (const group of grouped.values()) {
    for (let offset = 0; offset < group.bindings.length; offset += maxQueriesPerRequest) {
      batches.push({
        accountId: group.accountId,
        region: group.region,
        entries: group.bindings.slice(offset, offset + maxQueriesPerRequest).map((binding, index) => ({
          binding,
          queryId: `m${batches.length}_${index}`
        }))
      });
    }
  }

  return batches;
}

function metricDataQueryFor(entry: CloudWatchMetricBatchEntry): MetricDataQuery {
  const binding = entry.binding;
  const dimensions = Object.entries(binding.cloudwatch.dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([Name, Value]) => ({ Name, Value }));

  return {
    Id: entry.queryId,
    ReturnData: true,
    ...(binding.cloudwatch.account_id ? { AccountId: binding.cloudwatch.account_id } : {}),
    MetricStat: {
      Metric: {
        Namespace: binding.cloudwatch.namespace,
        MetricName: binding.cloudwatch.metric_name,
        ...(dimensions.length > 0 ? { Dimensions: dimensions } : {})
      },
      Period: binding.cloudwatch.period_seconds,
      Stat: binding.cloudwatch.statistic,
      ...(binding.cloudwatch.unit ? { Unit: binding.cloudwatch.unit } : {})
    }
  } as MetricDataQuery;
}

function metricMessage(result: MetricDataResult | undefined, fallback: string): string {
  const messages = result?.Messages?.map((message) => message.Value).filter((value): value is string => Boolean(value));
  return messages && messages.length > 0 ? messages.join("; ") : fallback;
}

function latestValueFromResult(result: MetricDataResult | undefined): { value: number; timestamp?: string } | undefined {
  if (!result?.Values || result.Values.length === 0) {
    return undefined;
  }

  let latest: { value: number; timestamp?: string; time: number } | undefined;
  for (let index = 0; index < result.Values.length; index += 1) {
    const value = result.Values[index];
    if (typeof value !== "number" || Number.isNaN(value)) {
      continue;
    }
    const timestamp = result.Timestamps?.[index]?.toISOString();
    const time = timestamp ? new Date(timestamp).getTime() : index;
    if (!latest || time > latest.time) {
      latest = { value, timestamp, time };
    }
  }

  return latest ? { value: latest.value, timestamp: latest.timestamp } : undefined;
}

async function fetchBatch(
  batch: CloudWatchMetricBatch,
  options: Required<Pick<FetchCloudWatchMetricOptions, "lookbackSeconds" | "clientFactory">> &
    Pick<FetchCloudWatchMetricOptions, "now">
): Promise<MetricFetchResult[]> {
  const now = options.now ?? new Date();
  const commandInput: GetMetricDataCommandInput = {
    StartTime: new Date(now.getTime() - options.lookbackSeconds * 1000),
    EndTime: now,
    ScanBy: "TimestampDescending",
    MetricDataQueries: batch.entries.map(metricDataQueryFor)
  };
  const client = options.clientFactory(batch);

  try {
    const response = await client.send(new GetMetricDataCommand(commandInput));
    const resultById = new Map((response.MetricDataResults ?? []).map((result) => [result.Id, result]));
    return batch.entries.map((entry) => {
      const result = resultById.get(entry.queryId);
      const latest = latestValueFromResult(result);
      if (!result) {
        return {
          bindingId: entry.binding.id,
          status: "error",
          message: "CloudWatch response did not include a result for this query"
        };
      }
      if (!latest) {
        return {
          bindingId: entry.binding.id,
          status: result.StatusCode === "Complete" ? "missing" : "error",
          message: metricMessage(result, result.StatusCode === "Complete" ? "No datapoints returned" : "CloudWatch query did not complete")
        };
      }
      return {
        bindingId: entry.binding.id,
        status: "ok",
        value: latest.value,
        timestamp: latest.timestamp
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CloudWatch request failed";
    return batch.entries.map((entry) => ({
      bindingId: entry.binding.id,
      status: "error",
      message
    }));
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export function createCloudWatchMetricDataClientFactory(): CloudWatchMetricDataClientFactory {
  const clients = new Map<string, CloudWatchClient>();

  return (batch) => {
    const client = clients.get(batch.region) ?? new CloudWatchClient({ region: batch.region });
    clients.set(batch.region, client);
    return client;
  };
}

function stableHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash, 31) + input.charCodeAt(index);
  }
  return hash >>> 0;
}

function stubMetricValue(binding: AwsMetricBinding, now: Date): number {
  const hash = stableHash(binding.id);
  const bucket = Math.floor(now.getTime() / Math.max(1, binding.cloudwatch.period_seconds * 1000));
  const wave = Math.sin(((bucket + (hash % 17)) / 12) * Math.PI * 2);
  const metricName = binding.cloudwatch.metric_name.toLowerCase();

  if (metricName.includes("latency")) {
    return Math.max(1, Math.round(80 + (hash % 120) + wave * 45));
  }
  if (metricName.includes("approximate") || metricName.includes("depth") || metricName.includes("queue")) {
    return Math.max(0, Math.round(250 + (hash % 1500) + wave * 180));
  }
  if (metricName.includes("records") || metricName.includes("messages")) {
    return Math.max(1, Math.round(25_000 + (hash % 150_000) + wave * 8_000));
  }

  return Math.max(1, Math.round(100 + (hash % 900) + wave * 75));
}

export function createStubCloudWatchMetricDataClientFactory(
  options: { mode?: Exclude<AwsOverlayStubMode, "off">; now?: Date } = {}
): CloudWatchMetricDataClientFactory {
  const mode = options.mode ?? "ok";

  return (batch) => ({
    async send(command: GetMetricDataCommand): Promise<GetMetricDataCommandOutput> {
      const now = options.now ?? command.input.EndTime ?? new Date();

      return {
        $metadata: {},
        MetricDataResults: batch.entries.map((entry) => {
          if (mode === "partial" && entry.binding.id.includes("partner-route")) {
            return {
              Id: entry.queryId,
              StatusCode: "Complete",
              Values: [],
              Timestamps: [],
              Messages: [{ Value: `Stubbed missing datapoint for ${entry.binding.id}` }]
            };
          }
          if (mode === "partial" && entry.binding.cloudwatch.region !== "us-east-1") {
            return {
              Id: entry.queryId,
              StatusCode: "InternalError",
              Values: [],
              Timestamps: [],
              Messages: [{ Value: `Stubbed CloudWatch error for ${entry.binding.id}` }]
            };
          }

          return {
            Id: entry.queryId,
            StatusCode: "Complete",
            Values: [stubMetricValue(entry.binding, now)],
            Timestamps: [now]
          };
        })
      };
    }
  });
}

export async function fetchCloudWatchMetricsForBindings(
  bindings: AwsMetricBinding[],
  options: FetchCloudWatchMetricOptions = {}
): Promise<MetricFetchResult[]> {
  const maxQueriesPerRequest = Math.max(
    1,
    Math.min(DEFAULT_MAX_QUERIES_PER_REQUEST, Math.floor(options.maxQueriesPerRequest ?? DEFAULT_MAX_QUERIES_PER_REQUEST))
  );
  const maxConcurrentRequests = Math.max(1, Math.floor(options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS));
  const clientFactory = options.clientFactory ?? createCloudWatchMetricDataClientFactory();
  const batches = buildCloudWatchMetricDataBatches(bindings, maxQueriesPerRequest);
  const batchResults = await mapWithConcurrency(batches, maxConcurrentRequests, (batch) =>
    fetchBatch(batch, {
      now: options.now,
      lookbackSeconds: options.lookbackSeconds ?? DEFAULT_LOOKBACK_SECONDS,
      clientFactory
    })
  );

  return batchResults.flat();
}

function formatNumber(value: number, precision: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  }).format(value);
}

function formatMetricValue(binding: AwsMetricBinding, value: number): string {
  const scaled = value * binding.overlay.scale;
  const formatted = formatNumber(scaled, binding.overlay.precision);
  return binding.overlay.unit ? `${formatted} ${binding.overlay.unit}` : formatted;
}

function scaledMetricValue(binding: AwsMetricBinding, value: number): number {
  return value * binding.overlay.scale;
}

function isWarning(binding: AwsMetricBinding, value: number): boolean {
  const warning = binding.overlay.warning;
  if (!warning) {
    return false;
  }
  const scaled = scaledMetricValue(binding, value);
  return (
    (warning.gte !== undefined && scaled >= warning.gte) ||
    (warning.gt !== undefined && scaled > warning.gt) ||
    (warning.lte !== undefined && scaled <= warning.lte) ||
    (warning.lt !== undefined && scaled < warning.lt)
  );
}

function metricPartsFor(
  binding: AwsMetricBinding,
  result: MetricFetchResult | undefined
): {
  metrics: OverlayMetric[];
  metricLabel?: string;
  badges: string[];
  warning: boolean;
  notes: string[];
} {
  const badges = [...binding.overlay.badges];

  if (result?.status === "ok" && result.value !== undefined) {
    const value = formatMetricValue(binding, result.value);
    return {
      metrics: [{ label: binding.overlay.label, value }],
      metricLabel: value,
      badges,
      warning: isWarning(binding, result.value),
      notes: result.timestamp ? [`observed ${result.timestamp}`] : []
    };
  }

  const status = result?.status ?? "missing";
  const badge = status === "error" ? binding.overlay.error_badge : binding.overlay.missing_badge;
  const message = result?.message ?? "No datapoints returned";

  return {
    metrics: [],
    metricLabel: badge,
    badges: [...badges, badge],
    warning: true,
    notes: [message]
  };
}

function buildNodeDecorator(binding: AwsMetricBinding, result: MetricFetchResult | undefined): NodeDecorator {
  const parts = metricPartsFor(binding, result);
  return {
    id: overlayDecoratorIdForBinding(binding),
    node_id: binding.target.id,
    title: binding.overlay.title ?? binding.id,
    metrics: parts.metrics,
    badges: parts.badges,
    notes: parts.notes
  };
}

function buildEdgeDecorator(binding: AwsMetricBinding, result: MetricFetchResult | undefined): EdgeDecorator {
  const parts = metricPartsFor(binding, result);
  return {
    id: overlayDecoratorIdForBinding(binding),
    edge_id: binding.target.id,
    title: binding.overlay.title ?? binding.id,
    metric_label: parts.metricLabel,
    badges: parts.badges,
    metrics: parts.metrics,
    warning: parts.warning,
    tone: binding.overlay.tone,
    thickness: binding.overlay.thickness
  };
}

function buildRouteDecorator(
  binding: AwsMetricBinding,
  result: MetricFetchResult | undefined,
  baseOverlays: ArchitectureOverlays
): RouteDecorator {
  const route = baseOverlays.route_decorators.find((decorator) => decorator.id === binding.target.id);
  if (!route) {
    throw new Error(`Metric binding ${binding.id} references missing route decorator: ${binding.target.id}`);
  }
  const parts = metricPartsFor(binding, result);

  return {
    id: overlayDecoratorIdForBinding(binding),
    source_node_id: route.source_node_id,
    edge_ids: [...route.edge_ids],
    title: binding.overlay.title ?? binding.id,
    metric_label: parts.metricLabel,
    badges: parts.badges,
    metrics: parts.metrics,
    warning: parts.warning,
    tone: binding.overlay.tone,
    thickness: binding.overlay.thickness
  };
}

export function buildAwsMetricOverlaySnapshot(
  baseOverlays: ArchitectureOverlays,
  bindings: AwsMetricBinding[],
  results: MetricFetchResult[]
): ArchitectureOverlays {
  const resultByBindingId = new Map(results.map((result) => [result.bindingId, result]));
  const nodeDecorators: NodeDecorator[] = [];
  const edgeDecorators: EdgeDecorator[] = [];
  const routeDecorators: RouteDecorator[] = [];

  for (const binding of bindings) {
    const result = resultByBindingId.get(binding.id);
    switch (binding.target.kind) {
      case "node":
        nodeDecorators.push(buildNodeDecorator(binding, result));
        break;
      case "edge":
        edgeDecorators.push(buildEdgeDecorator(binding, result));
        break;
      case "route":
        routeDecorators.push(buildRouteDecorator(binding, result, baseOverlays));
        break;
    }
  }

  return {
    node_decorators: nodeDecorators,
    edge_decorators: edgeDecorators,
    route_decorators: routeDecorators,
    controls: []
  };
}

async function postOverlaySnapshot(options: PostSnapshotOptions): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(options.overlayApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      overlays: options.overlays,
      mode: "merge",
      source: options.source,
      generatedAt: options.generatedAt
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Overlay snapshot rejected with ${response.status}: ${body}`);
  }
}

export async function runAwsOverlayCollectorOnce(
  config: AwsOverlayCollectorConfig,
  options: FetchCloudWatchMetricOptions & { fetchFn?: typeof fetch } = {}
): Promise<AwsOverlayCollectorSummary> {
  const inputs = await loadAwsOverlayCollectorInputs(config);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const clientFactory =
    options.clientFactory ??
    (config.stubMode === "off"
      ? undefined
      : createStubCloudWatchMetricDataClientFactory({ mode: config.stubMode, now: options.now }));
  const results = await fetchCloudWatchMetricsForBindings(inputs.bindings, {
    now: options.now,
    lookbackSeconds: config.lookbackSeconds,
    maxQueriesPerRequest: config.maxQueriesPerRequest,
    maxConcurrentRequests: config.maxConcurrentRequests,
    clientFactory
  });
  const overlays = buildAwsMetricOverlaySnapshot(inputs.baseOverlays, inputs.bindings, results);
  await postOverlaySnapshot({
    overlayApiUrl: config.overlayApiUrl,
    overlays,
    source: config.source,
    generatedAt,
    fetchFn: options.fetchFn
  });

  return {
    bindingCount: inputs.bindings.length,
    okCount: results.filter((result) => result.status === "ok").length,
    missingCount: results.filter((result) => result.status === "missing").length,
    errorCount: results.filter((result) => result.status === "error").length,
    generatedAt
  };
}
