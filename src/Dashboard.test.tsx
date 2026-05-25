import "./test/setup";
import { readFileSync } from "node:fs";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import { Dashboard } from "./Dashboard";
import { validateArchitectureManifest } from "./zod";

function renderSeedDashboard() {
  const yaml = readFileSync("public/architecture.yaml", "utf8");
  const manifest = validateArchitectureManifest(parse(yaml));
  return render(<Dashboard manifest={manifest} />);
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
    expect(screen.getAllByText("Hot Router").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Slow Streams").length).toBeGreaterThan(0);
  });

  it("renders selected views from manifest IDs instead of fixed canonical IDs", async () => {
    const user = userEvent.setup();
    const yaml = readFileSync("public/architecture.yaml", "utf8");
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

    expect(screen.getByText("edge.use1.sources.to.ingestion")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.ingestion.to.processing")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.processing.to.aggregate")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.aggregate.to.hot.router")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.aggregate.to.cold.router")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.partner.stream")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.slow")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.processor.to.products.stream")).toBeInTheDocument();
  });

  it("selects rendered edges and shows original and visible endpoint metadata", async () => {
    const user = userEvent.setup();
    const { container } = renderSeedDashboard();
    const edge = await waitFor(() => {
      const element = container.querySelector('[data-id="edge.use1.sources.to.ingestion"]');
      expect(element).toBeInTheDocument();
      return element;
    });

    await user.click(edge as Element);

    const detailPanel = screen.getByRole("complementary", { name: "Selected edge details" });
    expect(within(detailPanel).getByText("originalFrom")).toBeInTheDocument();
    expect(within(detailPanel).getAllByText("use1.sources.apps").length).toBeGreaterThan(0);
    expect(within(detailPanel).getByText("visibleFrom")).toBeInTheDocument();
    expect(within(detailPanel).getByText("cross_region")).toBeInTheDocument();
    expect(within(detailPanel).getByText("edge.use1.sources.to.ingestion")).toBeInTheDocument();
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

  it("selects a cross-region route and preserves derived edge metadata", async () => {
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
    expect(within(detailPanel).getByText("originalFrom")).toBeInTheDocument();
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

  it("collapses groups without losing rolled-up visible edge context", async () => {
    const user = userEvent.setup();
    renderSeedDashboard();

    await user.click(screen.getByRole("button", { name: "Collapse USE1 Hot" }));

    expect(screen.queryByText("Hot Router")).not.toBeInTheDocument();
    expect(screen.getAllByText("USE1 Hot").length).toBeGreaterThan(0);
    expect(screen.getByText("edge.use1.aggregate.to.hot.router")).toBeInTheDocument();
  });
});
