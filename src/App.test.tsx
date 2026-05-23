import "./test/setup";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import architectureFixture from "../public/config/architecture.json";
import desiredFixture from "../public/config/desired-throttles.json";
import liveFixture from "../public/config/live-throttles.json";
import trafficFixture from "../public/config/traffic-snapshot.json";

const snapshots: Record<string, unknown> = {
  "/config/architecture.json": architectureFixture,
  "/config/desired-throttles.json": desiredFixture,
  "/config/live-throttles.json": liveFixture,
  "/config/traffic-snapshot.json": trafficFixture
};

function installFetchMock(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "http://localhost").pathname;
    calls.push(path);
    const body = overrides[path] ?? snapshots[path];

    if (!body) {
      return new Response("not found", { status: 404 });
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the seeded operator dashboard", async () => {
    installFetchMock();

    render(<App />);

    expect(await screen.findByTestId("dashboard-title")).toHaveTextContent("Data Pipeline Traffic Visualizer");
    expect(screen.getByRole("button", { name: /inspect event enrichment kcl/i })).toBeInTheDocument();
    expect(screen.getByText("Highest utilization surfaces")).toBeInTheDocument();
  });

  it("opens the throttle inspection drawer when clicking a service", async () => {
    installFetchMock();
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole("button", { name: /inspect stream router/i }));

    const drawer = screen.getByRole("complementary", { name: /throttle inspection drawer/i });
    expect(drawer).toHaveClass("open");
    expect(within(drawer).getByRole("heading", { name: "Stream Router" })).toBeInTheDocument();
    expect(within(drawer).getByText(/drift: enabled/i)).toBeInTheDocument();
    expect(
      within(drawer).getByText((_, element) => element?.textContent === "schema=order_event contributor=web")
    ).toBeInTheDocument();
  });

  it("refresh reloads all runtime snapshots", async () => {
    const { fetchMock } = installFetchMock();
    const user = userEvent.setup();

    render(<App />);

    await screen.findByTestId("dashboard-title");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await user.click(screen.getByRole("button", { name: /refresh configuration snapshots/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
  });
});
