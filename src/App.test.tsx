import "./test/setup";
import { render, screen } from "@testing-library/react";
import App from "./App";

function installFetchMock(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "text/yaml" } }))
  );
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a clear validation panel when YAML validation fails", async () => {
    installFetchMock("nodes:\n  - id: only-id\nedges: []\nviews: []\n");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load architecture.yaml");
    expect(screen.getByRole("alert")).toHaveTextContent("label");
  });
});
