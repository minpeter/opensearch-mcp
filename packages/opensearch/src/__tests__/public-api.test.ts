import { describe, expect, it } from "vitest";

import {
  fetchResultSchema,
  SEARCH_ENGINE_NAMES,
  SearchEngineError,
  SearchExecutionError,
  searchResultSchema,
} from "../index.ts";

describe("public API", () => {
  it("exports stable search and fetch schemas for library consumers", () => {
    const parsedSearchResult = searchResultSchema.parse({
      engine: "Bing",
      snippet: "Typed JavaScript at scale.",
      title: "TypeScript",
      url: "https://www.typescriptlang.org/",
    });
    const parsedFetchResult = fetchResultSchema.parse({
      content: "# Example",
      length: 9,
      title: "Example",
      url: "https://example.com",
    });

    expect(SEARCH_ENGINE_NAMES).toContain("Bing");
    expect(parsedSearchResult.engine).toBe("Bing");
    expect(parsedFetchResult.length).toBe(9);
  });

  it("exports typed search errors for library consumers", () => {
    const executionError = new SearchExecutionError("No Results", false);
    const engineError = new SearchEngineError("Bing", "blocked", "Blocked");

    expect(executionError.retryable).toBe(false);
    expect(engineError.engine).toBe("Bing");
    expect(engineError.kind).toBe("blocked");
  });
});
