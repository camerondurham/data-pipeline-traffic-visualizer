import "./test/setup";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import App from "./App";
import { buildSampleLiveTpsOverlays, SAMPLE_LIVE_TPS_SOURCE } from "./sampleLiveTps";
import { validateArchitectureManifest, validateArchitectureOverlays } from "./zod";
import type { RuntimeArchitecturePayload } from "./runtime/types";

class FakeEventSource {
  static instance?: FakeEventSource;
  readonly listeners = new Map<string, Array<() => void>>();

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

describe("App", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    FakeEventSource.instance = undefined;
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
