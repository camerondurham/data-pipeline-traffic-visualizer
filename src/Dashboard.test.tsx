import "./test/setup";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import { Dashboard } from "./Dashboard";
import { validateArchitectureManifest } from "./zod";

function renderSeedDashboard() {
  const yaml = readFileSync("public/architecture.yaml", "utf8");
  const manifest = validateArchitectureManifest(parse(yaml));
  return render(<Dashboard manifest={manifest} />);
}

describe("Dashboard", () => {
  it("renders the regional topology as ordered flow stages from the seed manifest", () => {
    renderSeedDashboard();

    expect(screen.getByTestId("dashboard-title")).toHaveTextContent("Architecture Topology Explorer");
    expect(screen.getByTestId("flow-diagram")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sourcing apps" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ingestion streams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data processing applications" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Aggregate Kinesis stream" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cold-tier router" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hot-tier router" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Partner streams" })).toBeInTheDocument();
    expect(screen.getAllByText("Hot Router").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Slow Streams").length).toBeGreaterThan(0);
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

  it("switches to destination-region grouped cross-region detail", async () => {
    const user = userEvent.setup();
    renderSeedDashboard();

    await user.selectOptions(screen.getByLabelText("View"), "cross_region_detail");

    expect(screen.getByRole("heading", { name: "Destination usw2" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Destination euw1" })).toBeInTheDocument();
    expect(screen.getByText("edge.use1.processing.to.usw2.aggregate")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.hot.router.to.usw2.partner.stream")).toBeInTheDocument();
    expect(screen.getByText("edge.use1.partner.slow_processor.to.usw2.partner.stream")).toBeInTheDocument();
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

  it("collapses groups without losing rolled-up visible edge context", async () => {
    const user = userEvent.setup();
    renderSeedDashboard();

    await user.click(screen.getByRole("button", { name: "Collapse USE1 Hot" }));

    expect(screen.queryByText("Hot Router")).not.toBeInTheDocument();
    expect(screen.getAllByText("USE1 Hot").length).toBeGreaterThan(0);
    expect(screen.getByText("edge.use1.aggregate.to.hot.router")).toBeInTheDocument();
  });
});
