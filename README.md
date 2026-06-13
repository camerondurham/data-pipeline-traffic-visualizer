# Runtime Architecture Console

YAML-backed operator console for mapping architecture topology, runtime overlays, and control intent across broad service areas.

## What

Runtime Architecture Console gives a team a reviewable architecture map plus runtime overlays for traffic, health, deployment state, and control intent. It is not a replacement for metric dashboards; it is the system map those dashboards usually assume exists.

The model is deliberately simple:

- `architecture.yaml` defines the stable topology: services, streams, queues, routes, clusters, dependencies, and views.
- `architecture-overlays.yaml` defines volatile operational context: traffic rates, scaling, throttles, health, deployment state, shard counts, and control state.
- The console renders both as one operator view so engineers can inspect where runtime facts sit in the broader service.

## Why

Large service areas create operator cognitive overhead. This project reduces that overhead by mapping topology and relevant configuration into a visual model: account boundaries, services, streams, processors, routes, throttles, deployment state, recent changes, and where each fact sits in the broader service.

CloudWatch and Grafana already solve broad observability problems. CloudWatch supports cross-account observability for AWS telemetry, dashboards can span accounts and Regions, Grafana can visualize metrics, logs, traces, and other data from many backends, and CloudWatch investigations can scan telemetry to surface related metrics, logs, deployment events, and root-cause hypotheses.

This project is complementary: it focuses on team-specific architecture topology and dependency knowledge across accounts, repositories, deployment systems, queues, streams, services, and operational conventions. The goal is to move that map out of senior engineers' heads, keep it explicit, and make the system easier to inspect, update, and reason about during operations.

## Philosophy

- Model the architecture first; telemetry should decorate the map, not define it.
- Keep topology and volatile metrics separate so slow-moving structure stays reviewable.
- Prefer an accurate cross-system view over a perfect integration with any single vendor.
- Make the console easy to update from jobs, scripts, or account-specific collectors.
- Preserve enough context that an engineer can understand what changed and where it sits in the larger service area.

## Runtime Architecture

At a high level, this is a YAML-backed console with a light runtime API. The architecture and overlays start from disk, the browser reads a validated runtime payload, the editor can lint and apply a draft, and update jobs can push fresh overlay snapshots without changing the topology.

```mermaid
sequenceDiagram
  participant Files as architecture.yaml and architecture-overlays.yaml
  participant Store as ArchitectureStore
  participant API as Runtime API
  participant Browser as Console and Runtime YAML editor
  participant Metrics as CloudWatch metrics
  participant Updater as AWS collector, overlay updater job, or local live TPS demo
  participant Operator as Graph control editor

  Files->>Store: load on startup and optional file watch
  Store->>Store: validate topology, overlays, and references
  Updater->>Metrics: GetMetricData batches by account and Region
  Metrics-->>Updater: latest datapoints, missing data, or partial errors
  Browser->>API: GET /api/architecture
  API->>Store: read current payload
  Store-->>Browser: manifest, overlays, revisions, status
  Browser->>API: GET /api/architecture/events
  Store-->>Browser: revision event after accepted changes
  Browser->>API: GET /api/architecture/source
  Browser->>API: POST /api/architecture/lint
  Browser->>API: POST /api/architecture/draft
  API->>Store: apply validated architecture and overlays draft
  Updater->>API: POST /api/overlays/snapshot
  API->>Store: merge observed overlay metrics after validation
  Operator->>API: POST /api/overlays/control-value
  API->>Store: validate intent and mark control applying
  Store->>Store: poll handler until terminal phase
  Store-->>Browser: revision event after observed apply result
```

## Local Live TPS Demo

Run the local API-backed demo with:

```bash
npm run demo:live
```

The command starts the Vite dev server, opens the existing runtime API middleware, and posts a complete sample overlay snapshot to `POST /api/overlays/snapshot` every 2 seconds. The console receives the existing SSE revision event, refetches `GET /api/architecture`, and updates stream TPS chips and edge labels without a separate dashboard data channel.

The live values are generated sample telemetry from the committed architecture; they are intended to demonstrate how a real collector would push full overlay snapshots.

## AWS CloudWatch Overlay Collector

Run the production-shaped CloudWatch pull collector with:

```bash
npm run collect:aws-overlays -- --once
```

Without `--once`, the collector keeps running and posts every 5 minutes by default. It reads `architecture.yaml`, `architecture-overlays.yaml`, and `metric-bindings.yaml`, queries CloudWatch, converts the latest datapoints into overlay decorators, then posts a merge snapshot to `POST /api/overlays/snapshot`.

For local UI verification without AWS credentials, run the same collector in stub mode:

```bash
npm run dev
AWS_OVERLAY_API_URL=http://127.0.0.1:5173/api/overlays/snapshot npm run collect:aws-overlays -- --stub --once
```

In PowerShell, set `$env:AWS_OVERLAY_API_URL="http://127.0.0.1:5173/api/overlays/snapshot"` before the collector command. `--stub` returns deterministic dummy datapoints through the same `GetMetricData` mapping path. `--stub-partial` simulates stale and error datapoints so the dashboard can be checked against partial CloudWatch responses.

The sample metric registry lives at `data/sample/metric-bindings.yaml`. Deployments should keep their real registry outside the public static build and point the collector at it with:

- `ARCHITECTURE_DATA_DIR`: directory containing `architecture.yaml` and `architecture-overlays.yaml`.
- `ARCHITECTURE_METRIC_BINDINGS_PATH`: path to the metric binding registry.
- `AWS_OVERLAY_API_URL` or `OVERLAY_API_URL`: runtime API snapshot endpoint.
- `AWS_OVERLAY_INTERVAL_MS`: schedule interval, default `300000`.
- `AWS_OVERLAY_LOOKBACK_SECONDS`: CloudWatch query window, default `900`.
- `AWS_OVERLAY_MAX_QUERIES_PER_REQUEST`: batch size, capped at CloudWatch `GetMetricData`'s 500 query request limit.
- `AWS_OVERLAY_MAX_CONCURRENT_REQUESTS`: concurrent CloudWatch requests, default `4`.
- `AWS_OVERLAY_STUB_MODE`: `ok` or `partial` to simulate CloudWatch without AWS credentials; equivalent CLI flags are `--stub` and `--stub-partial`.

Each metric binding attaches a predefined CloudWatch metric to a stable graph target:

```yaml
metric_bindings:
  - id: use1-orders-ingestion-incoming-records
    target:
      kind: node
      id: use1.ingestion.orders_stream
    cloudwatch:
      account_id: "111122223333"
      region: us-east-1
      namespace: AWS/Kinesis
      metric_name: IncomingRecords
      dimensions:
        StreamName: orders-ingestion
      statistic: Sum
      period_seconds: 300
    overlay:
      label: records
      unit: /5m
      warning:
        gte: 1000000
```

Run the collector in a monitoring account with CloudWatch cross-account observability configured for source accounts. The binding `account_id` is passed through to CloudWatch `GetMetricData`, and the collector groups requests by account and Region so one account or Region failure becomes error badges for only those bindings. Missing datapoints become stale badges; successful bindings still update in the same snapshot.

Use this pull model for five-minute overlays and bounded metric counts. If the binding registry grows into high-cardinality or near-real-time telemetry, move hot metrics to CloudWatch Metric Streams and have the stream processor materialize the same `ArchitectureOverlays` snapshot shape.

## GitHub Pages Demo

The GitHub Pages demo is a static build of Runtime Architecture Console from the sample YAML in `data/sample/`. It does not expose the runtime API or the local live TPS updater, but the Runtime YAML editor can lint and preview changes in the browser.

To publish it, enable GitHub Pages in the repository settings with **Source: GitHub Actions** and custom domain `traffic-demo.u64.cam`, then run the `Deploy Pages Demo` workflow or push to `main`. The workflow runs `npm ci`, `npm test`, and `npm run build` with `VITE_STATIC_DEMO=1` and `VITE_BASE_PATH=/`, then deploys `dist/`.

The deployed static demo also sets `VITE_GOATCOUNTER_COUNT_URL=https://u64cam.goatcounter.com/count`, which injects the same GoatCounter page-count script used by `camerondurham.github.io`.

The static demo also supports browser-only architecture replacement links:

```text
https://traffic-demo.u64.cam/#architecture=<base64url-utf8-architecture-yaml>
```

The fragment value is a base64url-encoded `architecture.yaml`. It replaces the sample topology and uses empty overlays, so the shared view stays focused on the architecture graph. Keep the payload in the hash fragment, not the query string: fragments are not sent to GitHub Pages, the Node runtime server, CDNs, or normal access logs. Anyone with the full URL can still read the encoded architecture, so do not share sensitive topology details in public links.

Use the Pages deployment URL from the workflow summary as the team demo link.

## Sample Workflow

## Control identity for live config edits

If you use this console as a live control surface, controls are tied to graph identity via:

- `target.kind` + `target.id` to attach intent to a node, edge, or route decorator.
- `dimensions` to scope by tenant/token/route class.
- `apply.handler` to choose the backend operation that applies config.

Control flow:

1. Operator updates `desired_value` in the UI.
2. Browser posts `POST /api/overlays/control-value`.
3. Store validates the control and marks it `applying`.
4. Handler returns an operation ID.
5. Store polls handler state until a terminal phase and then updates `effective_value`.

This model scales by keeping topology stable and using control metadata as the identity map for backend systems.

The screenshots below are generated from the committed sample files in `data/sample/` by `npm run screenshot:architecture`.

![Seed architecture workflow](docs/architecture-workflow.png)

The runtime editor opens the same architecture and overlay model that is currently rendered, so local edits can be linted and applied against the live console.

![Runtime architecture and overlay editor](docs/architecture-workflow-editor.png)

## Manifest Contract

The topology source of truth is `architecture.yaml`. The default representative sample lives at `data/sample/architecture.yaml`; deployments can point `ARCHITECTURE_DATA_DIR` at another non-public directory containing `architecture.yaml` and `architecture-overlays.yaml`.

Every node requires:

- `id`: stable node identifier used by views and future overlays.
- `label`: display name.
- `type`: display classification such as `app`, `stream`, `router`, `indexer`, `cluster`, `api`, `queue`, `processor`, or `group`.
- `region`: region code such as `use1`.
- `zone`: topology lane such as `pre_aggregate`, `aggregate`, `hot`, `cold`, or `partner`.
- `parent`: optional parent group node ID.

Every edge requires:

- `id`: stable edge identifier used by focus views and future overlays.
- `from`: source node ID.
- `to`: target node ID.
- `type`: edge classification such as `publish`, `feed`, `route`, `consume`, `index`, `serve`, `sideline`, `drain`, or `replay`.
- `label`: optional display text.

Views are explicit. The default sample view is a broad end-to-end path: it keeps the USE1 local workflow visible while staging summary destination streams for USW2 and EUW1 so cross-region publish behavior is visible without switching views. Per-region views retain deeper destination-region detail. The model also supports destination-region cross-region views and focus views with `focus_edges`, `primary_edges`, and `secondary_edges` lists of edge IDs, but those should be used sparingly for targeted investigations rather than as default navigation.

Region views can also define presentation metadata:

- `lanes`: named horizontal bands such as `cold`, `normal`, `hot`, `slow_lane`, and `partner`.
- `stages`: ordered left-to-right columns. Each stage has `id`, `label`, `lane`, and `node_ids`.

Stage `node_ids` must reference existing nodes. Layout metadata does not create topology and must not introduce synthetic nodes or edges.

## Overlay Contract

Decorators live in `architecture-overlays.yaml`. The default representative sample lives at `data/sample/architecture-overlays.yaml`. Overlays add real-world metrics and config to the rendered diagram without changing topology.

Overlay files can define:

- `node_decorators`: reference `node_id` and render compact node chips such as shard count, retention, OpenSearch node count, and instance type.
- `edge_decorators`: reference `edge_id` and render edge badges, warning state, metric labels, tone, or thickness.
- `route_decorators`: reference a `source_node_id` plus an ordered `edge_ids` path. Route decorators apply only to those explicit edges, which is the intended way to show source-app throttle/schema config downstream.
- `controls`: reference a node, edge, or route decorator and expose editable operator intent such as a per-token throttle. A control separates `spec` edit constraints from mutable `state`, so a throttle value is not confused with its min, max, step, unit, or priority policy.

Example:

```yaml
node_decorators:
  - id: orders-stream-capacity
    node_id: use1.ingestion.orders_stream
    title: Orders stream
    metrics:
      - label: shards
        value: 12
      - label: retention
        value: 24h

edge_decorators:
  - id: partner-feed-throttle
    edge_id: edge.use1.sources.partner.to.partner.ingestion
    title: Partner feed throttle
    badges:
      - throttle 500/s
      - schema partner-v3
    warning: true

route_decorators:
  - id: partner-source-downstream-throttle
    source_node_id: use1.sources.partner_webhook
    title: Partner webhook throttle path
    badges:
      - throttle 500/s
      - schema partner-v3
    edge_ids:
      - edge.use1.sources.partner.to.partner.ingestion
      - edge.use1.partner.ingestion.to.partner.processor
      - edge.use1.partner.processor.to.aggregate

controls:
  - id: partner-token-aggregate-throttle
    target:
      kind: route
      id: partner-source-downstream-throttle
    dimensions:
      token: partner-v3
    label: Partner route throttle
    apply:
      handler: simulated-throttle-config
    spec:
      value_type: number
      min: 0
      max: 2000
      step: 50
      unit: /s
      priority:
        editable: true
        min: 0
        max: 100
        step: 1
    state:
      desired_value: 500
      effective_value: 500
      priority: 20
      apply:
        phase: idle
```

## Topology Invariants

- `architecture.yaml` must not contain metrics, overlay values, AWS discovery output, CDK data, shard counts, replica counts, capacity settings, route keys, fanout semantics, or message metadata.
- Overlays must live in separate files and reference stable node IDs or edge IDs.
- Route overlays are explicit ordered paths; downstream throttle/schema decoration is not inferred by graph traversal.
- `crossRegion` is derived by comparing the direct source and target node regions.
- Rendered visual edges are one-to-one with manifest edges; grouping metadata does not hide nodes or roll up edges.

## Adding Topology

1. Add the node with a stable `id`, required display fields, and optional `parent`.
2. Add edges with stable IDs. Do not reuse or rename edge IDs once overlays depend on them.
3. Add node IDs to regional view `stages` when they should appear in the whiteboard-style sequential flow.
4. Add cross-region or focus views only when a route needs a dedicated investigation surface.
5. Keep partner topology in the `partner` zone. The initial sample model intentionally excludes partner entry streams, partner route streams, partner router apps, route keys, fanout semantics, message metadata, shard/replica/capacity config, AWS discovery, CDK parsing, overlays, and live metrics.

## Runtime API

The browser loads parsed architecture data from `GET /api/architecture`; raw YAML files are not exposed from `public/`.

- `GET /api/architecture`: returns `manifest`, current `overlays`, revisions, source, generated time, and status.
- `GET /api/architecture/events`: emits revision events with server-sent events so connected browsers refetch after runtime changes.
- `POST /api/overlays/snapshot`: runtime update job input for observed overlay metrics. Snapshot `mode` defaults to `merge`; use `control` only for authoritative control-backend observations.
- `POST /api/overlays/control-value`: starts one editable control apply operation. The server validates intent, marks the control `applying`, emits an overlay revision, polls the configured handler, and updates `effective_value` only after the simulated generated config is observed.

Overlay updaters should post `ArchitectureOverlays` snapshots every N minutes, or more frequently for local/demo use. Invalid snapshots are rejected and the previous active overlay remains visible. `npm run demo:live` is the sample implementation: it posts generated stream TPS overlays with `source: "sample-live-tps"` every 2 seconds.

Control edits are operator-owned runtime intent, not telemetry. The first control-plane stub stores operation state in memory, so edits survive refetches and SSE updates but reset on server restart. Controls are gated with split flags:

- `GRAPH_CONTROLS_VISIBLE=1`: show control cards and control-plane status in the console.
- `GRAPH_CONTROL_APPLY_ENABLED=1`: allow `POST /api/overlays/control-value` to call the configured handler.

A control edit request looks like:

```json
{
  "controlId": "partner-token-aggregate-throttle",
  "desiredValue": 750,
  "priority": 30,
  "source": "graph-control"
}
```

The server validates the control ID, target reference, explicit handler, value type, numeric bounds, step alignment, and whether priority is editable before starting an apply operation. The included `simulated-throttle-config` handler returns an operation ID immediately. The store polls until the handler reports a terminal phase or the poll budget expires, and `effective_value` updates only after observation.

See [Control Plane Extension Plan](docs/control-plane-extension.md) for how this model maps to a real SQS/S3 apply-and-poll control plane.
