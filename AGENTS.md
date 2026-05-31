# Agent Workflow

## Run

- Install dependencies with `npm install`.
- Start local development with `npm run dev`.
- Preview the production server with `npm run build` then `npm run start`.

## Verify

- Run `npm test` for the Vitest suite.
- Run `npm run build` before handing off production-server changes.
- `npm test` may print a Vitest teardown warning after passing; treat test failures, not that warning, as blocking.

## Compatibility

- Every compatibility shim must name a real consumer, have a removal condition, and have a test proving the consumer still needs it. Otherwise, remove it instead of preserving compatibility by default.

## Architecture Screenshots

- Run `npm run screenshot:architecture` after changing the workflow diagram, runtime editor, overlay rendering, or screenshot script.
- The command rebuilds the app and updates both `docs/architecture-workflow.png` and `docs/architecture-workflow-editor.png`.
- The editor screenshot must show the `Runtime YAML` panel with both `architecture.yaml` and `architecture-overlays.yaml` loaded from the currently rendered model.
- Update the README runtime architecture diagram when changing API endpoints, architecture store behavior, editor apply/lint/source flows, overlay snapshot updates, SSE revision events, or the way architecture/overlay data moves through the app.
