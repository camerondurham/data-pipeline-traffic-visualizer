import "./test/setup";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import { Dashboard } from "./Dashboard";
import { EMPTY_ARCHITECTURE_OVERLAYS, validateArchitectureManifest, validateArchitectureOverlays } from "./zod";

function renderSeedDashboard() {
  const yaml = readFileSync("data/sample/architecture.yaml", "utf8");
  const overlaysYaml = readFileSync("data/sample/architecture-overlays.yaml", "utf8");
  const manifest = validateArchitectureManifest(parse(yaml));
  const overlays = validateArchitectureOverlays(parse(overlaysYaml));
  return render(<Dashboard manifest={manifest} overlays={overlays} />);
}

function expectInteractiveChrome(testId: string) {
  const graph = screen.getByTestId(testId);
  expect(within(graph).getByTestId("rf__controls")).toBeInTheDocument();
  expect(within(graph).getByTestId("rf__minimap")).toBeInTheDocument();
}

describe("Dashboard", () => {
  it("renders the regional topology as ordered flow stages from the seed manifest", () => {
    renderSeedDashboard();

    expect(screen.getByTestId("dashboard-title")).toHaveTextContent("Architecture Topology Explorer");
    expect(screen.getByTestId("flow-diagram")).toBeInTheDocument();
    expectInteractiveChrome("flow-diagram");
    expect(screen.getByRole("heading", { name: "Sourcing apps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ingestion streams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data processing applications" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aggregate Kinesis stream" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cold-tier router" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cold OpenSearch clusters" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cold API read surface" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hot-tier router" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hot OpenSearch clusters" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hot API read surface" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Partner streams" })).toBeInTheDocument();
    expect(screen.getAllByText("Web Storefront").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mobile App").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Webhook").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retail POS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orders Ingestion Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mobile Events Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orders Processing App").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hot Router").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Slow Streams").length).toBeGreaterThan(0);
  });

  it("renders node metric chips from architecture overlays", () => {
    renderSeedDashboard();

    expect(screen.getAllByText("12 shards").length).toBeGreaterThan(0);
    expect(screen.getAllByText("24h retention").length).toBeGreaterThan(0);
    expect(screen.getAllByText("6 nodes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("r7g.large.search").length).toBeGreaterThan(0);
  });

  it("renders with an explicitly empty overlay file", () => {
    const yaml = readFileSync("data/sample/architecture.yaml", "utf8");
    const manifest = validateArchitectureManifest(parse(yaml));

    render(<Dashboard manifest={manifest} overlays={EMPTY_ARCHITECTURE_OVERLAYS} />);

    expect(screen.getByTestId("dashboard-title")).toBeInTheDocument();
    expect(screen.getByTestId("flow-diagram")).toBeInTheDocument();
    expect(screen.queryByText("12 shards")).not.toBeInTheDocument();
  });

  it("renders selected views from manifest IDs instead of fixed canonical IDs", async () => {
    const user = userEvent.setup();
    const yaml = readFileSync("data/sample/architecture.yaml", "utf8");
    const manifest = validateArchitectureManifest(parse(yaml));
    manifest.views = manifest.views.map((view) => ({ ...view, id: `custom_${view.id}` }));

    render(<Dashboard manifest={manifest} />);

    expect(screen.getByRole("heading", { name: "Sourcing apps" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("View"), "custom_cross_region_detail");
    expect(screen.getByTestId("cross-region-map")).toBeInTheDocument();
    expectInteractiveChrome("cross-region-map");

    await user.selectOptions(screen.getByLabelText("View"), "custom_representative_partner_path");
    expect(screen.getByTestId("flow-stage-focus_partner_clusters")).toBeInTheDocument();
    expectInteractiveChrome("flow-diagram");
  });

  it("keeps the core sequential path and slow-lane replay edges visible in the regional diagram details", () => {
    renderSeedDashboard();

    expect(screen.getByText("edge.use1.sources.web.to.orders.ingestion")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.sources.mobile.to.mobile.ingestion")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.mobile.ingestion.to.orders.processor")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.orders.processor.to.aggregate")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.aggregate.to.hot.router")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.aggregate.to.cold.router")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.partner.stream")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.slow")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.processor.to.products.stream")).toBeInTheDocument();
  });

  it("selects rendered edges and shows direct endpoint metadata", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();
    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.sources.web.to.orders.ingestion"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    await user.click(edge as Element);

    const detailPanel = screen.getByRole("complementary", { name: "Selected edge details" });
    expect(within(detailPanel).getByText("from")).toBeInTheDocument();
    expect(within(detailPanel).getAllByText("use1.sources.web_storefront").length).toBeGreaterThan(0);
    expect(within(detailPanel).getByText("to")).toBeInTheDocument();
    expect(within(detailPanel).getByText("cross_region")).toBeInTheDocument();
    expect(within(detailPanel).getByText("edge.use1.sources.web.to.orders.ingestion")).toBeInTheDocument();
  });

  it("shows edge and route decorator annotations in the selected edge detail panel", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();
    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.sources.partner.to.partner.ingestion"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    const edgeLabels = Array.from(container.querySelectorAll(".edge-label"));
    const partnerFeedLabel = edgeLabels.find((label) => label.textContent?.includes("partner feed"));
    expect(partnerFeedLabel).toBeTruthy();
    expect(partnerFeedLabel).toHaveTextContent("throttle 500/s");
    expect(partnerFeedLabel).toHaveTextContent("schema partner-v3");
    expect(within(partnerFeedLabel as HTMLElement).getByLabelText("partner feed overlay labels")).toBeInTheDocument();
    expect(screen.getAllByText("throttle 500/s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("schema partner-v3").length).toBeGreaterThan(0);

    expect(container.querySelector('[data-testid="selected-edge-annotation-partner-feed-throttle"]')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="selected-edge-annotation-partner-source-downstream-throttle"]')).toHaveLength(0);
    expect(screen.queryByText("Partner feed throttle")).not.toBeInTheDocument();
    expect(screen.queryByText("Partner webhook throttle path")).not.toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.sources.partner.to.partner.ingestion"] .topology-edge.is-warning')).toBeInTheDocument();

    await user.click(edge as Element);

    const detailPanel = screen.getByRole("complementary", { name: "Selected edge details" });
    expect(within(detailPanel).getByText("overlayDecorators")).toBeInTheDocument();
    expect(within(detailPanel).getByText("partner-feed-throttle")).toBeInTheDocument();
    expect(within(detailPanel).getByText("routeDecorators")).toBeInTheDocument();
    expect(within(detailPanel).getByText("partner-source-downstream-throttle")).toBeInTheDocument();

    expect(within(detailPanel).getByTestId("selected-edge-annotation-partner-feed-throttle")).toBeInTheDocument();
    expect(within(detailPanel).getAllByTestId("selected-edge-annotation-partner-source-downstream-throttle").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("Partner feed throttle").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("Partner webhook throttle path").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("throttle 500/s").length).toBeGreaterThan(0);
    expect(within(detailPanel).getAllByText("schema partner-v3").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid^="edge-annotation-"]')).not.toBeInTheDocument();
  });

  it("keeps group children visible without collapse controls", async () => {
    renderSeedDashboard();

    expect(screen.queryByRole("button", { name: /Collapse/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Web Storefront").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orders Ingestion Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Orders Processing App").length).toBeGreaterThan(0);
    expect(screen.getByText(/edge\.use1\.sources\.web\.to\.orders\.ingestion/)).toBeInTheDocument();
  });

  it("emphasizes the selected route through busy graph sections", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();
    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.hot.processor.to.products.stream"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    await user.click(edge as Element);

    expect(container.querySelector('[data-id="edge.use1.hot.processor.to.products.stream"] .topology-edge.is-selected')).toBeInTheDocument();
    expect(container.querySelector('[data-id="use1.hot.slow_processor"] .node-card.is-source')).toBeInTheDocument();
    expect(container.querySelector('[data-id="use1.hot.stream.products"] .node-card.is-target')).toBeInTheDocument();
    expect(container.querySelector(".topology-edge.is-dimmed")).toBeInTheDocument();
    expect(container.querySelector(".node-card.is-dimmed")).toBeInTheDocument();
  });

  it("highlights incoming and outgoing edges when selecting a node", async () => {
    const { container } = renderSeedDashboard();
    const node = await waitFor(() => {
      const element = container.querySelector('[data-id="use1.hot.router"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    await act(async () => {
      fireEvent.click(node as Element);
      await Promise.resolve();
    });

    const detailPanel = screen.getByRole("complementary", { name: "Selected node details" });
    expect(within(detailPanel).getByText("use1.hot.router")).toBeInTheDocument();
    expect(within(detailPanel).getByText("Incoming (1)")).toBeInTheDocument();
    expect(within(detailPanel).getByText("Outgoing (5)")).toBeInTheDocument();
    expect(within(detailPanel).getByText("edge.use1.aggregate.to.hot.router")).toBeInTheDocument();
    expect(within(detailPanel).getByText("edge.use1.hot.router.to.products.stream")).toBeInTheDocument();

    expect(container.querySelector('[data-id="use1.hot.router"] .node-card.is-selected')).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.aggregate.to.hot.router"] .topology-edge.is-incoming')).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.hot.router.to.products.stream"] .topology-edge.is-outgoing')).toBeInTheDocument();
    expect(container.querySelector('[data-id="use1.aggregate.stream"] .node-card.is-incoming')).toBeInTheDocument();
    expect(container.querySelector('[data-id="use1.hot.stream.products"] .node-card.is-outgoing')).toBeInTheDocument();
    expect(container.querySelector(".topology-edge.is-dimmed")).toBeInTheDocument();
  });

  it("routes stacked slow-lane edges through separate visual lanes", async () => {
    const { container } = renderSeedDashboard();

    await waitFor(() => {
      expect(container.querySelector('[data-id="edge.use1.hot.router.to.slow"] .topology-edge')).toBeInTheDocument();
      expect(container.querySelector('[data-id="edge.use1.hot.indexers.to.slow"] .topology-edge')).toBeInTheDocument();
    });

    const routerPath = container
      .querySelector('[data-id="edge.use1.hot.router.to.slow"] .topology-edge')
      ?.getAttribute("d");
    const indexerPath = container
      .querySelector('[data-id="edge.use1.hot.indexers.to.slow"] .topology-edge')
      ?.getAttribute("d");

    expect(routerPath).toBeTruthy();
    expect(indexerPath).toBeTruthy();
    expect(routerPath).not.toEqual(indexerPath);
  });

  it("separates API read surfaces from OpenSearch cluster write stages", async () => {
    const { container } = renderSeedDashboard();

    expect(screen.getByTestId("flow-stage-cold_clusters")).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-cold_api")).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-hot_clusters")).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-hot_api")).toBeInTheDocument();

    await waitFor(() => {
      expect(container.querySelector('[data-id="edge.use1.cold.products.cluster.to.api"] .topology-edge.tone-read')).toBeInTheDocument();
    });
    expect(container.querySelector('[data-id="use1.cold.api"] .node-card.type-api')).toBeInTheDocument();
  });

  it("switches to destination-region grouped cross-region detail", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();

    await user.selectOptions(screen.getByLabelText("View"), "cross_region_detail");

    expect(screen.getByTestId("cross-region-map")).toBeInTheDocument();
    expectInteractiveChrome("cross-region-map");
    expect(screen.getByText("Source use1")).toBeInTheDocument();
    expect(screen.getAllByText("Destination usw2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Destination euw1").length).toBeGreaterThan(0);
    expect(screen.getByText("Steady partner publish")).toBeInTheDocument();
    expect(screen.getByText("Remote aggregate publish")).toBeInTheDocument();
    expect(screen.getByText("Remote replay")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.processing.to.usw2.aggregate")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.usw2.partner.stream")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.partner.slow_processor.to.usw2.partner.stream")).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.hot.router.to.usw2.partner.stream"]')).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.hot.router.to.euw1.partner.stream"]')).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.processing.to.usw2.aggregate"]')).toBeInTheDocument();
    expect(container.querySelector('[data-id="edge.use1.partner.slow_processor.to.usw2.partner.stream"] .tone-secondary')).toBeInTheDocument();
  });

  it("switches to regional topology views for each modeled region", async () => {
    const user = userEvent.setup();
    renderSeedDashboard();

    await user.selectOptions(screen.getByLabelText("View"), "regional_usw2");
    expect(screen.getByRole("heading", { name: "usw2 sequential architecture flow" })).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-usw2_aggregate_stream")).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-usw2_partner_clusters")).toBeInTheDocument();
    expect(screen.getAllByText("USW2 Aggregate Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USW2 Partner Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USW2 Partner Cluster C").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("View"), "regional_euw1");
    expect(screen.getByRole("heading", { name: "euw1 sequential architecture flow" })).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-euw1_aggregate_stream")).toBeInTheDocument();
    expect(screen.getByTestId("flow-stage-euw1_partner_clusters")).toBeInTheDocument();
    expect(screen.getAllByText("EUW1 Aggregate Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EUW1 Partner Stream").length).toBeGreaterThan(0);
    expect(screen.getAllByText("EUW1 Partner Cluster A").length).toBeGreaterThan(0);
  });

  it("selects a cross-region route and preserves edge metadata", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();

    await user.selectOptions(screen.getByLabelText("View"), "cross_region_detail");
    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.hot.router.to.usw2.partner.stream"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    await user.click(edge as Element);

    const detailPanel = screen.getByRole("complementary", { name: "Selected edge details" });
    expect(within(detailPanel).getByText("from")).toBeInTheDocument();
    expect(within(detailPanel).getAllByText("use1.hot.router").length).toBeGreaterThan(0);
    expect(within(detailPanel).getByText("destinationRegion")).toBeInTheDocument();
    expect(within(detailPanel).getByText("usw2")).toBeInTheDocument();
    expect(within(detailPanel).getByText("cross_region")).toBeInTheDocument();
    expect(within(detailPanel).getByText("true")).toBeInTheDocument();
    expect(within(detailPanel).getByText("edge.use1.hot.router.to.usw2.partner.stream")).toBeInTheDocument();
  });

  it("renders branching primary focus edges and secondary fallback edges", async () => {
    const user = userEvent.setup();
    renderSeedDashboard();

    await user.selectOptions(screen.getByLabelText("View"), "representative_partner_path");

    expect(screen.getByTestId("flow-stage-focus_partner_clusters")).toBeInTheDocument();
    expect(screen.getAllByText("USW2 Partner Cluster A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USW2 Partner Cluster B").length).toBeGreaterThan(0);
    expect(screen.getAllByText("USW2 Partner Cluster C").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Slow Streams").length).toBeGreaterThan(0);
    expect(screen.getByText("edge.use1.partner.slow_processor.to.usw2.partner.stream")).toBeInTheDocument();
  });

  it("keeps graph controls available after switching views and selecting an edge", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();

    expectInteractiveChrome("flow-diagram");

    await user.selectOptions(screen.getByLabelText("View"), "representative_partner_path");
    expectInteractiveChrome("flow-diagram");

    await user.selectOptions(screen.getByLabelText("View"), "cross_region_detail");
    expectInteractiveChrome("cross-region-map");

    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.hot.router.to.usw2.partner.stream"]');
      expect(element).toBeInTheDocument();
      return element;
    });
    await user.click(edge as Element);

    expect(screen.getByRole("complementary", { name: "Selected edge details" })).toBeInTheDocument();
    expectInteractiveChrome("cross-region-map");
  });

});
