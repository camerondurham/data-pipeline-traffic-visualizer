import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type GetMetricDataCommand, type GetMetricDataCommandInput } from "@aws-sdk/client-cloudwatch";
import { parse } from "yaml";
import {
  buildAwsMetricOverlaySnapshot,
  buildCloudWatchMetricDataBatches,
  createStubCloudWatchMetricDataClientFactory,
  fetchCloudWatchMetricsForBindings,
  readAwsOverlayCollectorConfig,
  type CloudWatchMetricDataClientFactory
} from "./awsOverlayCollector";
import { validateAwsMetricBindingsDocument, type AwsMetricBinding } from "./awsMetricBindings";
import { validateOverlayReferences } from "./overlays";
import { validateArchitectureDocuments } from "./server/runtimeValidation";
import type { ArchitectureManifest, ArchitectureOverlays } from "./zod";

interface LoadedInputs {
  manifest: ArchitectureManifest;
  overlays: ArchitectureOverlays;
  bindings: AwsMetricBinding[];
}

function loadInputs(): LoadedInputs {
  const architecture = validateArchitectureDocuments(
    readFileSync("data/sample/architecture.yaml", "utf8"),
    readFileSync("data/sample/architecture-overlays.yaml", "utf8")
  );
  const bindings = validateAwsMetricBindingsDocument(
    architecture.manifest,
    architecture.overlays,
    parse(readFileSync("data/sample/metric-bindings.yaml", "utf8"))
  ).metric_bindings;

  return {
    manifest: architecture.manifest,
    overlays: architecture.overlays,
    bindings
  };
}

describe("AWS overlay collector", () => {
  it("defaults metric bindings to the configured architecture data directory", () => {
    const config = readAwsOverlayCollectorConfig({
      ARCHITECTURE_DATA_DIR: "ops-architecture"
    } as NodeJS.ProcessEnv);

    expect(config.dataDir).toBe(resolve("ops-architecture"));
    expect(config.bindingsPath).toBe(resolve("ops-architecture", "metric-bindings.yaml"));
    expect(config.stubMode).toBe("off");
    expect(config.source).toBe("aws-cloudwatch");
  });

  it("enables stub mode from collector environment", () => {
    const config = readAwsOverlayCollectorConfig({
      AWS_OVERLAY_STUB_MODE: "partial"
    } as NodeJS.ProcessEnv);

    expect(config.stubMode).toBe("partial");
    expect(config.source).toBe("aws-cloudwatch-stub");
  });

  it("groups CloudWatch queries by account and region with request-size chunks", () => {
    const { bindings } = loadInputs();
    const batches = buildCloudWatchMetricDataBatches(bindings, 2);

    expect(batches.map((batch) => `${batch.accountId}:${batch.region}:${batch.entries.length}`)).toEqual([
      "111122223333:us-east-1:2",
      "444455556666:us-east-1:1",
      "444455556666:us-west-2:1"
    ]);
    expect(batches.every((batch) => batch.entries.length <= 2)).toBe(true);
  });

  it("keeps the sample edge metric on an edge whose AWS label can render", () => {
    const { overlays, bindings } = loadInputs();
    const binding = bindings.find((candidate) => candidate.id === "use1-hot-products-index-latency");

    expect(binding).toBeDefined();
    expect(overlays.edge_decorators.some((decorator) => decorator.edge_id === binding?.target.id && decorator.metric_label)).toBe(
      false
    );
  });

  it("fetches latest datapoints and emits partial errors per binding", async () => {
    const { bindings } = loadInputs();
    const capturedInputs: GetMetricDataCommandInput[] = [];
    const clientFactory: CloudWatchMetricDataClientFactory = (batch) => ({
      async send(command: GetMetricDataCommand) {
        capturedInputs.push(command.input);
        if (batch.region === "us-west-2") {
          throw new Error("regional CloudWatch outage");
        }
        return {
          $metadata: {},
          MetricDataResults: batch.entries.map((entry, index) => ({
            Id: entry.queryId,
            StatusCode: "Complete",
            Values: [100 + index, 50 + index],
            Timestamps: [new Date("2026-06-13T12:00:00Z"), new Date("2026-06-13T11:55:00Z")]
          }))
        };
      }
    });

    const results = await fetchCloudWatchMetricsForBindings(bindings, {
      now: new Date("2026-06-13T12:05:00Z"),
      lookbackSeconds: 900,
      maxQueriesPerRequest: 5,
      clientFactory
    });

    expect(capturedInputs[0].ScanBy).toBe("TimestampDescending");
    expect(capturedInputs[0].MetricDataQueries?.[0].AccountId).toBe("111122223333");
    expect(capturedInputs[0].MetricDataQueries?.[0].MetricStat?.Metric?.Namespace).toBe("AWS/Kinesis");
    expect(results.find((result) => result.bindingId === "use1-orders-ingestion-incoming-records")).toMatchObject({
      status: "ok",
      value: 100,
      timestamp: "2026-06-13T12:00:00.000Z"
    });
    expect(results.find((result) => result.bindingId === "usw2-partner-index-latency")).toMatchObject({
      status: "error",
      message: "regional CloudWatch outage"
    });
  });

  it("can fetch deterministic stub datapoints without AWS credentials", async () => {
    const { bindings } = loadInputs();
    const now = new Date("2026-06-13T12:05:00Z");
    const results = await fetchCloudWatchMetricsForBindings(bindings, {
      now,
      clientFactory: createStubCloudWatchMetricDataClientFactory({ mode: "ok", now })
    });

    expect(results).toHaveLength(bindings.length);
    expect(results.every((result) => result.status === "ok")).toBe(true);
    expect(results.find((result) => result.bindingId === "use1-orders-ingestion-incoming-records")?.value).toBeGreaterThan(
      1000
    );
  });

  it("can simulate partial CloudWatch data in stub mode", async () => {
    const { bindings } = loadInputs();
    const now = new Date("2026-06-13T12:05:00Z");
    const results = await fetchCloudWatchMetricsForBindings(bindings, {
      now,
      clientFactory: createStubCloudWatchMetricDataClientFactory({ mode: "partial", now })
    });

    expect(results.find((result) => result.bindingId === "use1-partner-route-publish-rate")).toMatchObject({
      status: "missing",
      message: "Stubbed missing datapoint for use1-partner-route-publish-rate"
    });
    expect(results.find((result) => result.bindingId === "usw2-partner-index-latency")).toMatchObject({
      status: "error",
      message: "Stubbed CloudWatch error for usw2-partner-index-latency"
    });
  });

  it("maps CloudWatch results into node, edge, and route overlay decorators", () => {
    const { manifest, overlays, bindings } = loadInputs();
    const selectedBindings = [
      bindings.find((binding) => binding.id === "use1-orders-ingestion-incoming-records"),
      bindings.find((binding) => binding.id === "use1-hot-products-index-latency"),
      bindings.find((binding) => binding.id === "use1-partner-route-publish-rate")
    ].filter((binding): binding is AwsMetricBinding => Boolean(binding));
    const snapshot = buildAwsMetricOverlaySnapshot(overlays, selectedBindings, [
      {
        bindingId: "use1-orders-ingestion-incoming-records",
        status: "ok",
        value: 12345,
        timestamp: "2026-06-13T12:00:00.000Z"
      },
      {
        bindingId: "use1-hot-products-index-latency",
        status: "ok",
        value: 275,
        timestamp: "2026-06-13T12:00:00.000Z"
      },
      {
        bindingId: "use1-partner-route-publish-rate",
        status: "missing",
        message: "No datapoints returned"
      }
    ]);

    validateOverlayReferences(manifest, snapshot);
    expect(snapshot.node_decorators[0]).toMatchObject({
      id: "aws-use1-orders-ingestion-incoming-records",
      node_id: "use1.ingestion.orders_stream",
      metrics: [{ label: "records", value: "12,345 /5m" }],
      badges: ["aws", "cloudwatch"]
    });
    expect(snapshot.node_decorators[0].notes).toEqual(["observed 2026-06-13T12:00:00.000Z"]);
    expect(snapshot.edge_decorators[0]).toMatchObject({
      id: "aws-use1-hot-products-index-latency",
      edge_id: "edge.use1.hot.indexers.to.products.cluster_b",
      metric_label: "275 ms",
      warning: true,
      tone: "primary"
    });
    expect(snapshot.route_decorators[0]).toMatchObject({
      id: "aws-use1-partner-route-publish-rate",
      source_node_id: "use1.sources.partner_webhook",
      metric_label: "stale",
      badges: ["aws", "partner", "stale"],
      warning: true
    });
    expect(snapshot.route_decorators[0].edge_ids).toEqual(
      overlays.route_decorators.find((decorator) => decorator.id === "partner-source-downstream-throttle")?.edge_ids
    );
    expect(snapshot.controls).toEqual([]);
  });
});
