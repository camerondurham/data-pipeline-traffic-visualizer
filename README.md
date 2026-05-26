# data-pipeline-traffic-visualizer

V0 Architecture Topology Explorer for an explicit YAML graph manifest.

## Run

```sh
npm install
npm run dev
```

Preview the production build:

```sh
npm run build
npm run start
```

Verify:

```sh
npm test
npm run build
```

Update the README diagram screenshots:

```sh
npx playwright install chromium # first time only
npm run screenshot:architecture
```

Pull requests and pushes to `main` are verified by `.github/workflows/verify.yml`, which runs `npm ci`, `npm test`, and `npm run build`.

## GitHub Pages Demo

The GitHub Pages demo is a static build from the sample YAML in `data/sample/`. It does not expose the runtime API, but the Runtime YAML editor works in the browser and saves valid drafts to local storage.

To publish it, enable GitHub Pages in the repository settings with **Source: GitHub Actions** and custom domain `traffic-demo.u64.cam`, then run the `Deploy Pages Demo` workflow or push to `main`. The workflow runs `npm ci`, `npm test`, and `npm run build` with `VITE_STATIC_DEMO=1` and `VITE_BASE_PATH=/`, then deploys `dist/`.

Use the Pages deployment URL from the workflow summary as the team demo link.

## Sample Workflow

The screenshots below are generated from the committed sample files in `data/sample/` by `npm run screenshot:architecture`.

![Seed architecture workflow](docs/architecture-workflow.png)

The runtime editor opens the same architecture and overlay model that is currently rendered, so local edits can be linted and applied against the live dashboard.

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
- `collapsed`: optional initial collapse state for group nodes.

Every edge requires:

- `id`: stable edge identifier used by focus views and future overlays.
- `from`: source node ID.
- `to`: target node ID.
- `type`: edge classification such as `publish`, `feed`, `route`, `consume`, `index`, `serve`, `sideline`, `drain`, or `replay`.
- `label`: optional display text.

Views are explicit. Region views select a region, cross-region views group derived cross-region edges by destination region, and focus views use `focus_edges`, `primary_edges`, and `secondary_edges` lists of edge IDs.

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
```

## Topology Invariants

- `architecture.yaml` must not contain metrics, overlay values, AWS discovery output, CDK data, shard counts, replica counts, capacity settings, route keys, fanout semantics, or message metadata.
- Overlays must live in separate files and reference stable node IDs or edge IDs.
- Route overlays are explicit ordered paths; downstream throttle/schema decoration is not inferred by graph traversal.
- `crossRegion` is derived by comparing the original source and target node regions.
- Collapsed groups roll descendant edges up to the nearest visible ancestor. Rolled-up visual edges preserve `originalFrom`, `originalTo`, `visibleFrom`, `visibleTo`, and `sourceEdgeIds`.
- Rolled-up visual edges are deduplicated and self-loops caused by collapsing parent groups are suppressed.

## Adding Topology

1. Add the node with a stable `id`, required display fields, and optional `parent`.
2. Add edges with stable IDs. Do not reuse or rename edge IDs once overlays depend on them.
3. Add edge IDs to focus views when a route should be highlighted.
4. Add node IDs to regional view `stages` when they should appear in the whiteboard-style sequential flow.
5. Keep partner topology in the `partner` zone. The v0 model intentionally excludes partner entry streams, partner route streams, partner router apps, route keys, fanout semantics, message metadata, shard/replica/capacity config, AWS discovery, CDK parsing, overlays, and live metrics.

## Runtime API

The browser loads parsed architecture data from `GET /api/architecture`; raw YAML files are not exposed from `public/`.

- `GET /api/architecture`: returns `manifest`, current `overlays`, revisions, source, generated time, and status.
- `GET /api/architecture/events`: emits revision events with server-sent events so connected browsers refetch after runtime changes.
- `POST /api/overlays/snapshot`: full overlay replacement for runtime update jobs.

Overlay updaters should post a complete `ArchitectureOverlays` snapshot every N minutes. Invalid snapshots are rejected and the previous active overlay remains visible.
