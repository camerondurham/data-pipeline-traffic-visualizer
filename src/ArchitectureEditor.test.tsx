import "./test/setup";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parse } from "yaml";
import { ArchitectureEditor } from "./ArchitectureEditor";
import { validateArchitectureManifest, validateArchitectureOverlays } from "./zod";

function loadSeedData() {
  const manifest = validateArchitectureManifest(parse(readFileSync("data/sample/architecture.yaml", "utf8")));
  const overlays = validateArchitectureOverlays(parse(readFileSync("data/sample/architecture-overlays.yaml", "utf8")));
  return { manifest, overlays };
}

describe("ArchitectureEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not render failed editor actions as successful validation", async () => {
    const user = userEvent.setup();
    const { manifest, overlays } = loadSeedData();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/architecture/lint") {
          return new Response(JSON.stringify({ ok: true, diagnostics: [], manifest, overlays }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (url === "/api/architecture/source") {
          return new Response(JSON.stringify({ error: "source unavailable" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
        throw new Error(`Unexpected request ${url}`);
      })
    );

    render(
      <ArchitectureEditor
        enabled
        manifest={manifest}
        overlays={overlays}
        onPreview={vi.fn()}
        onApplied={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Runtime YAML/i }));
    await screen.findByLabelText("architecture.yaml");

    await user.click(screen.getByRole("button", { name: /^Lint$/i }));
    expect(await screen.findByText("Previewing validated draft")).toHaveClass("aws-alert-success");

    await user.click(screen.getByRole("button", { name: /^Load$/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("source unavailable"));
    expect(screen.getByRole("status")).toHaveClass("aws-alert-error");
    expect(screen.getByRole("status")).not.toHaveClass("aws-alert-success");
  });
});
