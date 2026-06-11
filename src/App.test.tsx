import "./test/setup";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import App from "./App";
import { encodeBase64UrlUtf8 } from "./deepLinkArchitecture";
import { buildSampleLiveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE } from "./sampleLiveTps";
import { validateArchitectureManifest, validateArchitectureOverlays } from "./zod";
import type { RuntimeArchitecturePayload } from "./runtime/types";

class FakeEventSource {
  static instance?: FakeEventSource;
  readonly listeners = new Map<string, Array<() => void>>();
  closed = false;

  constructor(_url: string) {
    FakeEventSource.instance = this;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  close() {
    this.closed = true;
    this.listeners.clear();
  }
}

function installFetchMock(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
  );
}

function loadSeedPayload(): RuntimeArchitecturePayload {
  return {
    manifest: validateArchitectureManifest(parse(readFileSync("data/sample/architecture.yaml", "utf8"))),
    overlays: validateArchitectureOverlays(parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8"))),
    architectureRevision: 1,
    overlayRevision: 1,
    overlayGeneratedAt: "2026-05-25T12:00:00.000Z",
    overlaySource: "sample",
    overlayStatus: { state: "sample" },
    editorEnabled: false,
    graphControlsVisible: false,
    graphControlApplyEnabled: false
  };
}

const LINKED_ARCHITECTURE_YAML = `
nodes:
  - id: linked.source
    label: Linked Source
    type: app
    region: demo
    zone: pre_aggregate
  - id: linked.sink
    label: Linked Sink
    type: stream
    region: demo
    zone: aggregate
edges:
  - id: edge.linked.source.to.sink
    from: linked.source
    to: linked.sink
    type: publish
views:
  - id: linked-demo
    label: Linked Demo
    mode: region
    region: demo
    lanes:
      - id: normal
        label: Normal
    stages:
      - id: source
        label: Source
        lane: normal
        node_ids:
          - linked.source
      - id: sink
        label: Sink
        lane: normal
        node_ids:
          - linked.sink
`;

describe("App", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    FakeEventSource.instance = undefined;
    window.history.replaceState(null, "", "/");
  });

  it("renders a clear validation panel when runtime architecture validation fails", async () => {
    installFetchMock({
      manifest: { nodes: [{ id: "only-id" }], edges: [], views: [] },
      overlays: {},
      architectureRevision: 1,
      overlayRevision: 1,
      overlayGeneratedAt: new Date().toISOString(),
      overlaySource: "test",
      overlayStatus: { state: "file" },
      editorEnabled: false,
      graphControlsVisible: false,
      graphControlApplyEnabled: false
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load runtime architecture");
    expect(screen.getByRole("alert")).toHaveTextContent("label");
  });

  it("renders a clear validation panel when runtime overlay validation fails", async () => {
    const manifest = loadSeedPayload().manifest;
    installFetchMock({
      manifest,
      overlays: { node_decorators: [{ id: "missing-node", node_id: "missing" }] },
      architectureRevision: 1,
      overlayRevision: 1,
      overlayGeneratedAt: new Date().toISOString(),
      overlaySource: "test",
      overlayStatus: { state: "file" },
      editorEnabled: false,
      graphControlsVisible: false,
      graphControlApplyEnabled: false
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load runtime architecture");
    expect(screen.getByRole("alert")).toHaveTextContent("missing node");
  });

  it("refetches and rerenders live TPS overlay updates after a runtime revision event", async () => {
    let payload = loadSeedPayload();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }))
    );
    vi.stubGlobal("EventSource", FakeEventSource);

    render(<App />);

    expect(await screen.findAllByText("12 shards")).not.toHaveLength(0);

    const liveTpsOverlays = buildSampleLiveTpsOverlays(payload.overlays, { tick: 1 });
    const expectedOrdersTps = liveTpsOverlays.node_decorators.find(
      (decorator) => decorator.id === "live-tps-orders-ingestion-stream"
    )?.metrics[0]?.value;
    payload = {
      ...payload,
      overlayRevision: 2,
      overlaySource: SAMPLE_LIVE_TPS_SOURCE,
      overlayStatus: { state: "dynamic" },
      overlays: liveTpsOverlays
    };

    FakeEventSource.instance?.emit("revision");

    expect(await screen.findAllByText(`${expectedOrdersTps} TPS`)).not.toHaveLength(0);
    expect(screen.getByText(SAMPLE_LIVE_TPS_SOURCE)).toBeInTheDocument();
  });

  it("lets static demo users preview and reset sample YAML without runtime API calls", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubEnv("VITE_STATIC_DEMO", "1");
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);

    render(<App />);

    expect(await screen.findAllByText("12 shards")).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instance).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /Runtime YAML/i }));
    expect(screen.queryByRole("button", { name: /^Apply$/i })).not.toBeInTheDocument();

    const overlaysEditor = screen.getByLabelText("architecture-overlays.yaml") as HTMLTextAreaElement;
    fireEvent.change(overlaysEditor, {
      target: { value: overlaysEditor.value.replace("value: 12", "value: 99") }
    });

    await user.click(screen.getByRole("button", { name: /^Lint$/i }));
    expect(await screen.findByText("99 shards")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Previewing validated static YAML");

    fireEvent.change(overlaysEditor, {
      target: { value: "node_decorators: [" }
    });
    await user.click(screen.getByRole("button", { name: /^Lint$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("overlays");
    await waitFor(() => expect(screen.queryByText("99 shards")).not.toBeInTheDocument());
    expect(await screen.findAllByText("12 shards")).not.toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /^Reset$/i }));
    expect(await screen.findAllByText("12 shards")).not.toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads a hash-fragment architecture deep link without runtime API calls", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    window.history.replaceState(null, "", `/#architecture=${encodeBase64UrlUtf8(LINKED_ARCHITECTURE_YAML)}`);

    render(<App />);

    expect(await screen.findAllByText("Linked Source")).not.toHaveLength(0);
    expect(screen.getAllByText("Linked Sink")).not.toHaveLength(0);
    expect(screen.getByText("deep-link")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instance).toBeUndefined();

    await user.click(screen.getByRole("button", { name: /Runtime YAML/i }));
    expect((screen.getByLabelText("architecture.yaml") as HTMLTextAreaElement).value).toContain("Linked Source");
    expect((screen.getByLabelText("architecture-overlays.yaml") as HTMLTextAreaElement).value).toContain("node_decorators: []");
    expect(screen.queryByRole("button", { name: /^Apply$/i })).not.toBeInTheDocument();
  });

  it("reloads architecture and closes runtime events when only the hash changes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(loadSeedPayload()), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);

    render(<App />);

    expect(await screen.findAllByText("12 shards")).not.toHaveLength(0);
    const runtimeEvents = FakeEventSource.instance;
    expect(runtimeEvents).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.history.pushState(null, "", `/#architecture=${encodeBase64UrlUtf8(LINKED_ARCHITECTURE_YAML)}`);
    window.dispatchEvent(new Event("hashchange"));

    expect(await screen.findAllByText("Linked Source")).not.toHaveLength(0);
    expect(screen.getByText("deep-link")).toBeInTheDocument();
    expect(runtimeEvents?.closed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders a deep-link-specific error when linked YAML is invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", `/#architecture=${encodeBase64UrlUtf8("nodes: [")}`);

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load deep-link architecture");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("seeds the runtime YAML editor from the currently rendered model", async () => {
    const user = userEvent.setup();
    const payload = { ...loadSeedPayload(), editorEnabled: true };
    installFetchMock(payload);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /Runtime YAML/i }));

    expect((screen.getByLabelText("architecture.yaml") as HTMLTextAreaElement).value).toContain("nodes:");
    expect((screen.getByLabelText("architecture-overlays.yaml") as HTMLTextAreaElement).value).toContain("node_decorators:");
    expect(screen.getByText("Loaded currently rendered model")).toBeInTheDocument();
  });

  it("surfaces the graph controls visible-only badge when controls are visible but apply is disabled", async () => {
    installFetchMock({ ...loadSeedPayload(), graphControlsVisible: true, graphControlApplyEnabled: false });

    render(<App />);

    expect(await screen.findByText("Graph Controls Visible Only")).toBeInTheDocument();
    expect(screen.getByText("Control cards are visible, but Apply is disabled until backend integration is enabled.")).toBeInTheDocument();
  });
});
