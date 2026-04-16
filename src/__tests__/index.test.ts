import { describe, expect, it } from "vitest";

import { createFetchToolResult, createSearchToolResult } from "../index.ts";

describe("tool result shaping", () => {
  it("renders search results as detailed text plus structured results", () => {
    const results = [
      {
        engine: "Bing",
        snippet: "Typed JavaScript at scale.",
        title: "TypeScript",
        url: "https://www.typescriptlang.org/",
      },
    ];

    const toolResult = createSearchToolResult("typescript", results);

    expect(toolResult.content).toEqual([
      {
        type: "text",
        text: [
          'Returned 1 search results for "typescript".',
          "",
          "1. [Bing] TypeScript",
          "URL: https://www.typescriptlang.org/",
          "Snippet: Typed JavaScript at scale.",
        ].join("\n"),
      },
    ]);
    expect(toolResult.structuredContent).toEqual({ results });
  });

  it("keeps full fetch body in content and only metadata in structured content", () => {
    const toolResult = createFetchToolResult({
      content: "# Example\n\nBody text",
      length: 20,
      title: "Example",
      url: "https://example.com",
    });

    expect(toolResult.content).toEqual([
      {
        type: "text",
        text: "# Example\n\nBody text",
      },
    ]);
    expect(toolResult.structuredContent).toEqual({
      title: "Example",
      url: "https://example.com",
      length: 20,
    });
  });
});
