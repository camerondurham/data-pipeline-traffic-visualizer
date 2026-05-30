# Control Plane Extension Plan

This project currently supports editable overlay controls as a runtime experiment. It is not yet a production control plane. The current flow is intentionally small: the graph editor posts a desired value to the runtime API, the server validates it against the overlay control `spec`, stores it in memory, increments the overlay revision, and emits the existing SSE event.

The model was shaped so it can grow into a real control plane without moving control-specific logic into React components.

The experiment is feature-flagged. Set `GRAPH_CONTROLS_PREVIEW=1` to expose editable controls and the dashboard preview badge. Without the flag, the runtime payload reports the preview as disabled, the graph does not render control edit cards, and `POST /api/overlays/control-value` returns `403`.

## Current Control Model

Controls live in `architecture-overlays.yaml` and attach to a graph target:

- `target`: node, edge, or route decorator reference.
- `dimensions`: qualifiers such as `token: partner-v3`.
- `spec`: edit contract, including type, min, max, step, unit, and priority policy.
- `state.desired_value`: operator intent.
- `state.effective_value`: value observed from the real system.
- `state.priority`: optional operator-controlled priority.

The separation between desired and effective state is the important control-plane boundary. The UI edits intent; backend integrations should prove whether the system actually converged.

## Extension Point

The server-side seam is:

- `src/server/apiMiddleware.ts`: accepts `POST /api/overlays/control-value`.
- `src/server/architectureStore.ts`: `updateOverlayControlValue` and `buildUpdatedControlOverlay`.
- `src/runtime/types.ts`: request and response types.

The React `OverlayControlCard` should stay generic. It should not know how to call throttle services, deployment systems, queue APIs, or account-specific tooling. It should submit operator intent and render state returned by the runtime payload.

## Target Architecture

Add a backend control handler layer behind `updateOverlayControlValue`:

```ts
interface OverlayControlHandler {
  apply(request: ControlApplyRequest): Promise<ControlApplyResult>;
  poll(operationId: string): Promise<ControlPollResult>;
  readEffectiveValue(controlId: string): Promise<ControlObservedState>;
}
```

The store should become an orchestrator:

1. Validate the requested control value against `spec`.
2. Update `state.desired_value`.
3. Mark the control as applying.
4. Call the registered handler for the control.
5. Persist or retain an operation ID.
6. Poll the external system or accept callback/snapshot updates.
7. Update `state.effective_value` only after the external system confirms the applied state.
8. Emit SSE revision events after each meaningful transition.

Handler selection should be explicit. A future control can add a stable backend routing field such as:

```yaml
apply:
  handler: partner-throttle-service
```

Do not infer handler behavior from display labels or graph IDs.

## Future State Shape

When real apply orchestration is added, extend each control state with apply metadata:

```yaml
state:
  desired_value: 250
  effective_value: 500
  priority: 20
  apply:
    phase: applying
    operation_id: throttle-change-123
    requested_at: 2026-05-30T13:00:00.000Z
    observed_at: 2026-05-30T13:00:08.000Z
    message: Waiting for downstream throttle config
```

Recommended phases:

- `idle`: desired and effective values are not known to be diverging.
- `applying`: an external operation is in flight.
- `applied`: the external system confirmed the requested state.
- `rejected`: validation passed locally, but the external system rejected the change.
- `failed`: the external operation failed or timed out.
- `stale`: effective state has not been observed recently enough.

## Polling And Snapshots

There are two viable convergence paths:

- The control handler polls the external API and updates the active overlay state.
- An external collector posts full overlay snapshots to `POST /api/overlays/snapshot`, including refreshed `effective_value` and apply metadata.

For local experiments, in-memory operation state is acceptable. For a real control plane, operation state should be durable enough to survive server restart and should include timestamps, handler identity, external request IDs, and error details.

## Safety Rules

- Keep architecture topology read-only during control edits.
- Keep telemetry snapshots separate from operator intent.
- Do not let full overlay snapshots silently erase in-flight control operation state unless the snapshot is from the authoritative control backend.
- Validate all values server-side even if the UI already constrains inputs.
- Add authentication and authorization before exposing apply endpoints outside a trusted local environment.
- Log/audit every requested control edit with actor, requested value, target, dimensions, handler, and operation ID.
