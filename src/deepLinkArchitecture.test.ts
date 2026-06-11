import { buildArchitectureDeepLink, decodeBase64UrlUtf8, encodeBase64UrlUtf8, loadArchitectureDeepLink } from "./deepLinkArchitecture";

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

describe("architecture deep links", () => {
  it("round trips UTF-8 YAML through base64url", () => {
    const value = `label: Cafe\u0301 \u{1F680}\n${LINKED_ARCHITECTURE_YAML}`;

    expect(decodeBase64UrlUtf8(encodeBase64UrlUtf8(value))).toBe(value);
  });

  it("builds a hash-fragment link without putting YAML in the query string", () => {
    const link = buildArchitectureDeepLink(LINKED_ARCHITECTURE_YAML, "https://traffic-demo.example/view?existing=1#old");
    const url = new URL(link);

    expect(url.search).toBe("?existing=1");
    expect(url.search).not.toContain("Linked");
    expect(url.hash).toMatch(/^#architecture=/);
    expect(url.hash).not.toContain("Linked Source");
  });

  it("loads a validated architecture from the hash with empty overlays", () => {
    const encoded = encodeBase64UrlUtf8(LINKED_ARCHITECTURE_YAML);
    const result = loadArchitectureDeepLink(`#architecture=${encoded}`);

    expect(result?.payload.manifest.nodes.map((node) => node.label)).toContain("Linked Source");
    expect(result?.payload.overlays).toEqual({
      node_decorators: [],
      edge_decorators: [],
      route_decorators: [],
      controls: []
    });
    expect(result?.payload.overlaySource).toBe("deep-link");
    expect(result?.source.architectureYaml).toBe(LINKED_ARCHITECTURE_YAML);
    expect(result?.source.overlaysYaml).toContain("node_decorators: []");
  });

  it("rejects malformed base64url payloads", () => {
    expect(() => loadArchitectureDeepLink("#architecture=not.valid")).toThrow("not valid base64url");
  });
});
