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
  it("renders the regional topology lanes from the seed manifest", () => {
    renderSeedDashboard();

    expect(screen.getByTestId("dashboard-title")).toHaveTextContent("Architecture Topology Explorer");
    expect(screen.getByRole("heading", { name: "pre aggregate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "aggregate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "hot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "cold" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "partner" })).toBeInTheDocument();
    expect(screen.getAllByText("Hot Router").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partner Slow Streams").length).toBeGreaterThan(0);
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
