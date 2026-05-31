# Control Plane Extension Plan

This project now has a gated control-plane stub. It is still not a production control plane, but it proves the lifecycle the real backend needs: the graph submits operator intent, the server validates it, a handler accepts an async apply operation, and `effective_value` changes only after a later observation confirms convergence.

The React control card stays generic. It should not call throttle services, SQS, S3, deployment systems, or account-specific tooling directly.

## Runtime Gates

- `GRAPH_CONTROLS_VISIBLE=1`: show control cards and control-plane status.
- `GRAPH_CONTROL_APPLY_ENABLED=1`: allow `POST /api/overlays/control-value` to invoke handlers.
- `GRAPH_CONTROLS_PREVIEW=1`: compatibility alias for visible-only mode.

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

## Server Extension Point

The control-plane integration seam is:

- `src/server/apiMiddleware.ts`: accepts `POST /api/overlays/control-value` and enforces `GRAPH_CONTROL_APPLY_ENABLED`.
- `src/server/architectureStore.ts`: validates controls, marks operations applying, schedules polling, and emits SSE revisions.
- `src/server/controlHandlers.ts`: defines `OverlayControlHandler` and the simulated handler.

The handler interface is intentionally small:

```ts
interface OverlayControlHandler {
  apply(request: ControlApplyRequest): Promise<ControlApplyResult>;
  poll(operationId: string): Promise<ControlPollResult>;
}
```

For the internal throttle system, add a handler keyed by `apply.handler` that:

1. Sends an SQS message with control ID, token/dimensions, desired value, priority, actor, and operation ID.
2. Returns the operation ID immediately so the UI can show `applying`.
3. Polls the generated S3 throttle config or an internal API that reads it.
4. Parses the authoritative config and returns `applied`, `rejected`, `failed`, or `stale`.
5. Includes the observed effective value only after the generated config confirms it.

## Overlay Snapshot Separation

Telemetry snapshots are observed truth, not operator intent. Non-control snapshots merge decorator updates by ID and preserve controls so live traffic updates do not erase desired state or in-flight operations.

Use `source: "control-backend"` only for authoritative control-backend snapshots that intentionally refresh control state. Even then, in-flight operation metadata is preserved unless the incoming control remains in `applying`.

## Production Follow-Ups

- Persist operation state so applies survive server restart.
- Add actor identity, authorization, and audit logging before exposing apply outside a trusted environment.
- Add timeout/staleness policy for operations that never converge.
- Replace the simulated handler with SQS send and S3/config polling.
- Keep topology read-only during control edits.
