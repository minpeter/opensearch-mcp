import { describe, expect, it } from "vitest";

import type { FetchResult } from "../fetch.ts";
import {
  createFetchToolResult,
  createSearchContent,
  getFetchUrls,
  webFetchInputSchema,
} from "../tool-io.ts";

function createFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    title: "Example title",
    url: "https://example.com/article",
    content: "# Example\n\nBody copy",
    length: "# Example\n\nBody copy".length,
    ...overrides,
  };
}

describe("webFetchInputSchema", () => {
  it("accepts the legacy url field", () => {
    const parsed = webFetchInputSchema.parse({
      url: "https://example.com/legacy",
    });

    expect(parsed.url).toBe("https://example.com/legacy");
  });

  it("accepts batch urls", () => {
    const parsed = webFetchInputSchema.parse({
      urls: ["https://example.com/one", "https://example.com/two"],
    });

    expect(parsed.urls).toHaveLength(2);
  });
});

describe("getFetchUrls", () => {
  it("merges and deduplicates url and urls while preserving order", () => {
    const urls = getFetchUrls({
      url: "https://example.com/one",
      urls: [
        "https://example.com/one",
        "https://example.com/two",
        "https://example.com/three",
      ],
    });

    expect(urls).toEqual([
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
    ]);
  });
});

describe("createFetchToolResult", () => {
  it("keeps single-fetch content backward compatible while adding structured results", () => {
    const result = createFetchResult();
    const toolResult = createFetchToolResult(result);

    expect(toolResult.content).toEqual([
      { type: "text", text: result.content },
    ]);
    expect(toolResult.structuredContent).toEqual({
      count: 1,
      results: [result],
      title: result.title,
      url: result.url,
      length: result.length,
    });
  });

  it("returns text-first blocks for multi-fetch responses", () => {
    const first = createFetchResult();
    const second = createFetchResult({
      title: "Second title",
      url: "https://example.com/second",
      content: "Second body",
      length: "Second body".length,
    });

    const toolResult = createFetchToolResult([first, second]);

    expect(toolResult.content).toHaveLength(3);
    expect(toolResult.content[0]).toEqual({
      type: "text",
      text: "Fetched 2 URLs. Each block below contains extracted markdown plus source metadata.",
    });
    expect(toolResult.content[1]?.text).toContain("# 1. Example title");
    expect(toolResult.content[1]?.text).toContain(
      "URL: https://example.com/article"
    );
    expect(toolResult.content[2]?.text).toContain("# 2. Second title");
    expect(toolResult.structuredContent).toEqual({
      count: 2,
      results: [first, second],
    });
  });
});

describe("createSearchContent", () => {
  it("renders compact human-readable search text", () => {
    const content = createSearchContent("example query", [
      {
        engine: "Brave",
        title: "Example",
        url: "https://example.com",
        snippet: "Example snippet",
      },
    ]);

    expect(content).toContain('Returned 1 search results for "example query".');
    expect(content).toContain("1. [Brave] Example");
  });
});
