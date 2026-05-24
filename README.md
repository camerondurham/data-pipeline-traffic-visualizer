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
npm run preview
```

Verify:

```sh
npm test
npm run build
```

Pull requests and pushes to `main` are verified by `.github/workflows/verify.yml`, which runs `npm ci`, `npm test`, and `npm run build`.

## Manifest Contract

The topology source of truth is `public/architecture.yaml`.

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

## Topology Invariants

- `architecture.yaml` must not contain metrics, overlay values, AWS discovery output, CDK data, shard counts, replica counts, capacity settings, route keys, fanout semantics, or message metadata.
- Future overlays must live in separate files and reference stable node IDs, edge IDs, or focus-view edge groups.
- `crossRegion` is derived by comparing the original source and target node regions.
- Collapsed groups roll descendant edges up to the nearest visible ancestor. Rolled-up visual edges preserve `originalFrom`, `originalTo`, `visibleFrom`, `visibleTo`, and `sourceEdgeIds`.
- Rolled-up visual edges are deduplicated and self-loops caused by collapsing parent groups are suppressed.

## Adding Topology

1. Add the node with a stable `id`, required display fields, and optional `parent`.
2. Add edges with stable IDs. Do not reuse or rename edge IDs once overlays depend on them.
3. Add edge IDs to focus views when a route should be highlighted.
4. Keep partner topology in the `partner` zone. The v0 model intentionally excludes partner entry streams, partner route streams, partner router apps, route keys, fanout semantics, message metadata, shard/replica/capacity config, AWS discovery, CDK parsing, overlays, and live metrics.
