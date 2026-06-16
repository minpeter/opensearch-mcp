import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readme = readFileSync(
  new URL("../../../../README.md", import.meta.url),
  "utf8"
);
const rootPackageJson = readFileSync(
  new URL("../../../../package.json", import.meta.url),
  "utf8"
);
const libraryPackageJson = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8"
);
const mcpPackageJson = readFileSync(
  new URL("../../../opensearch-mcp/package.json", import.meta.url),
  "utf8"
);

describe("README client interface", () => {
  it("leads with install, MCP setup, and the public client API", () => {
    const installIndex = readme.indexOf("## Install");
    const mcpIndex = readme.indexOf("## MCP Server");
    const clientIndex = readme.indexOf("## Client API");
    const providerIndex = readme.indexOf("## Providers");

    expect(installIndex).toBeGreaterThan(0);
    expect(mcpIndex).toBeGreaterThan(installIndex);
    expect(clientIndex).toBeGreaterThan(mcpIndex);
    expect(providerIndex).toBeGreaterThan(clientIndex);
  });

  it("documents only the stable library entry points in examples", () => {
    expect(readme).toContain(
      'import { createOpenSearch, fetch, search } from "@minpeter/opensearch";'
    );
    expect(readme).toContain(
      'import { fetch as nodeFetch } from "@minpeter/opensearch/node";'
    );
    expect(readme).toContain("root entry is edge-safe");
    expect(readme).toContain("Use the `/node` entry");
    expect(readme).toContain("const openSearch = createOpenSearch({");
    expect(readme).toContain("await search(");
    expect(readme).toContain("await nodeFetch(");

    expect(readme).not.toContain("fetchUrlsWithCache");
    expect(readme).not.toContain("searchWithRetryAndCache");
    expect(readme).not.toContain("searchOnce");
  });

  it("documents the MCP fetch defaults that clients actually see", () => {
    expect(readme).toContain("| `maxCharacters` | number | `12_000` |");
  });

  it("keeps README prose direct instead of generated-feature-list copy", () => {
    expect(readme).not.toContain("Best for:");
    expect(readme).not.toContain("Query tips:");
    expect(readme).not.toContain("Reviewed but not routed");
    expect(readme).not.toContain("Reviewed but not routed candidates");
  });

  it("keeps package descriptions aligned with the polished client interface", () => {
    expect(rootPackageJson).toContain(
      '"description": "Zero-config web search and page fetch for MCP clients"'
    );
    expect(libraryPackageJson).toContain(
      '"description": "Reusable web search and page fetch runtime for TypeScript clients"'
    );
    expect(mcpPackageJson).toContain(
      '"description": "Zero-config web search and page fetch MCP backed by @minpeter/opensearch"'
    );
  });
});
