import { describe, expect, it } from "vitest";

import { SCRAPE_SEARCH_ENGINES } from "../search/scrape.ts";

describe("Bing scrape fallback removal", () => {
  it("does not expose Bing as an internal scrape search engine", () => {
    expect(SCRAPE_SEARCH_ENGINES).toEqual({
      DuckDuckGo: expect.objectContaining({ name: "DuckDuckGo" }),
    });
    expect(Object.keys(SCRAPE_SEARCH_ENGINES)).not.toContain("Bing");
  });
});
