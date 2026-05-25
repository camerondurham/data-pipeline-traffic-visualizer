import "./test/setup";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import App from "./App";

function installFetchMock(body: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "text/yaml" } }))
  );
}

function installFetchMockByPath(responses: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url.split("?")[0].replace(/^\//, "");
      const body = responses[path];
      if (body === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(body, { status: 200, headers: { "Content-Type": "text/yaml" } });
    })
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

  it("renders a clear validation panel when overlay YAML validation fails", async () => {
    installFetchMockByPath({
      "architecture.yaml": readFileSync("public/architecture.yaml", "utf8"),
      "architecture-overlays.yaml": "node_decorators:\n  - id: missing-node\n    node_id: missing\n"
    });

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load architecture-overlays.yaml");
    expect(screen.getByRole("alert")).toHaveTextContent("missing node");
  });
});
