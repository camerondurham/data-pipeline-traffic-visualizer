# Control Plane Extension Plan

This project now has a gated control-plane stub. It is still not a production control plane, but it proves the lifecycle the real backend needs: the graph submits operator intent, the server validates it, a handler accepts an async apply operation, and `effective_value` changes only after a later observation confirms convergence.

The React control card stays generic. It should not call throttle services, SQS, S3, deployment systems, or account-specific tooling directly.

## Runtime Gates

- `GRAPH_CONTROLS_VISIBLE=1`: show control cards and control-plane status.
- `GRAPH_CONTROL_APPLY_ENABLED=1`: allow `POST /api/overlays/control-value` to invoke handlers.

The runtime payload exposes `graphControlsVisible` and `graphControlApplyEnabled`. Visible-only mode lets demos show the architecture and future control surface while clearly disabling Apply.

## Current Control Model

Controls live in `architecture-overlays.yaml` and attach to a graph target:

- `target`: node, edge, or route decorator reference.
- `dimensions`: qualifiers such as `token: partner-v3`.
- `apply.handler`: explicit backend routing key such as `simulated-throttle-config`.
- `spec`: edit contract, including type, min, max, step, unit, and priority policy.
- `state.desired_value`: operator intent.
- `state.effective_value`: value observed from the real system.
- `state.priority`: optional operator-controlled priority.
- `state.apply`: async operation phase, operation ID, timestamps, and message.

The key boundary is desired versus effective. The UI edits desired state; backend integrations prove whether the system converged.

### Control Identity (source-of-truth mapping)

Use this identity model to map a control click in the graph to a real service config object:

- `target.kind`: which object is controlled (`node`, `edge`, or `route`).
- `target.id`: stable identifier in the manifest (`node_id`, `edge_id`, or `route_decorator_id`).
- `dimensions`: optional qualifiers used as routing keys (`token`, `tenant`, `region`, `priorityClass`, etc.).
- `apply.handler`: backend handler key that knows how to apply that control intent.

Think of it as:

`edge ID + dimensions + handler` → `service config target`.

Example (edge throttle control):

```yaml
controls:
  - id: edge-hot-products-route-throttle
    target:
      kind: edge
      id: edge.use1.hot.router.to.products.stream
    dimensions:
      token: partner-v3
      tenant: premium
    label: Hot products partner throttle
    apply:
      handler: throttle-config-handler
    spec:
      value_type: number
      min: 0
      max: 2000
      step: 25
      unit: /s
    state:
      desired_value: 500
      apply:
        phase: idle
```

Attach one control to a route by setting `target.kind: route` and `target.id` to the route decorator ID when the intent applies to multiple edges.

Sequence (high-level):

1. Operator opens edge detail and clicks Apply.
2. UI posts to `POST /api/overlays/control-value`.
3. `apiMiddleware` validates and passes to `ArchitectureStore`.
4. Store validates control state, marks apply phase `applying`, calls handler `apply`, writes operation ID.
5. Store polls handler `poll` until phase becomes terminal (`applied`, `rejected`, `failed`, or `stale`).
6. `effective_value` updates only when terminal success is observed.
7. Store emits SSE revision; UI refetches and reflects real/observed state.

### Scalability model

For a live service-config editor, this model scales if you treat controls as a policy index rather than hardcoding every target in code:

- Keep throttle controls per logical edge for high-specificity tuning.
- Use route-level controls when one control intentionally spans multiple edges.
- Use `dimensions` to represent matrixes (tenant/token/route class) so you avoid thousands of flat control IDs.
- Keep manifests stable; treat identity fields (`id`, edge IDs, dimensions) as immutable API keys.
- Move large mappings to an external registry/config service the handler reads at apply time.
- Keep control appends non-blocking: one in-flight apply per control is enforced (`controlId` level), but the handler can fan out to many downstream systems.

This keeps the UI constant even as edge and policy count grow.

## Server Extension Point

The control-plane integration seam is:

- `src/server/apiMiddleware.ts`: accepts `POST /api/overlays/control-value` and enforces `GRAPH_CONTROL_APPLY_ENABLED`.
- `src/server/architectureStore.ts`: validates controls, rejects concurrent applies for the same control, schedules polling, and emits SSE revisions.
- `src/server/controlHandlers.ts`: defines `OverlayControlHandler` and the simulated handler.

The handler interface is intentionally small:

```ts
interface OverlayControlHandler {
  apply(request: ControlApplyRequest): Promise<ControlApplyResult>;
  poll(operationId: string): Promise<ControlPollResult>;
}
```

`poll` may return `applying` while the downstream system is still converging. The store reschedules polling until a terminal phase is observed or the poll budget expires.

For the internal throttle system, add a handler keyed by `apply.handler` that:

1. Sends an SQS message with control ID, token/dimensions, desired value, priority, actor, and operation ID.
2. Returns the operation ID immediately so the UI can show `applying`.
3. Polls the generated S3 throttle config or an internal API that reads it.
4. Parses the authoritative config and returns `applied`, `rejected`, `failed`, or `stale`.
5. Includes the observed effective value only after the generated config confirms it.

## Overlay Snapshot Separation

Telemetry snapshots are observed truth, not operator intent. Non-control snapshots merge decorator updates by ID and preserve controls so live traffic updates do not erase desired state or in-flight operations.

Use snapshot `mode: "control"` only for authoritative control-backend snapshots that intentionally refresh control state. In-flight operator intent is preserved unless the incoming control reports the same operation ID, so stale observations cannot overwrite a newer apply.

## Production Follow-Ups

- Persist operation state so applies survive server restart.
- Add actor identity, authorization, and audit logging before exposing apply outside a trusted environment.
- Tune timeout/staleness policy for real downstream convergence windows.
- Replace the simulated handler with SQS send and S3/config polling.
- Keep topology read-only during control edits.
