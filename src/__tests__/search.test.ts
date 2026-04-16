import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search, searchWithRetryAndCache } from "../search.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");
const ORIGINAL_ENV = { ...process.env };

function createMockResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function createMockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function resetSearchEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE;
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
}

describe("search", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("returns Brave results when Brave is configured and succeeds", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        web: {
          results: [
            {
              description:
                "GitHub is where over 100 million developers shape the future of software.",
              title: "GitHub · Build and ship software",
              url: "https://github.com/",
            },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Brave",
        snippet:
          "GitHub is where over 100 million developers shape the future of software.",
        title: "GitHub · Build and ship software",
        url: "https://github.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://api.search.brave.com/res/v1/web/search?count=10&q=github&search_lang=en"
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "brave-key",
        }),
        method: "GET",
      })
    );
  });

  it("falls back to Exa when Brave fails", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["GitHub is where people build software."],
              title: "GitHub",
              url: "https://github.com/",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "GitHub is where people build software.",
        title: "GitHub",
        url: "https://github.com/",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("continues to later providers when Brave auth is misconfigured", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "bad-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa fallback after Brave auth failure."],
              title: "Exa fallback",
              url: "https://example.com/exa-auth-fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Exa fallback after Brave auth failure.",
        title: "Exa fallback",
        url: "https://example.com/exa-auth-fallback",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("continues to scrape providers when Exa auth is misconfigured", async () => {
    process.env.EXA_API_KEY = "bad-exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "https://api.exa.ai/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "bad-exa-key",
        }),
        method: "POST",
      })
    );
  });

  it("falls back when Brave returns 403", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back from Brave empty results to Exa", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({
          web: {
            results: [],
          },
        })
      )
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [
            {
              highlights: ["Exa fallback result."],
              title: "Exa fallback",
              url: "https://example.com/exa-fallback",
            },
          ],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("fallback-test");

    expect(results).toEqual([
      {
        engine: "Exa",
        snippet: "Exa fallback result.",
        title: "Exa fallback",
        url: "https://example.com/exa-fallback",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back from Exa empty results to DuckDuckGo", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({
          results: [],
        })
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("fallback-test");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces unexpected Brave payloads instead of masking them as no-results", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ notWeb: true }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: Brave, DuckDuckGo, Bing [Brave:transient; DuckDuckGo:no-results; Bing:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("surfaces unexpected Exa payloads instead of masking them as no-results", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse({ notResults: true }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: Exa, DuckDuckGo, Bing [Exa:transient; DuckDuckGo:no-results; Bing:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("falls back to DuckDuckGo scrape when API providers are unavailable", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(results[0]?.engine).toBe("DuckDuckGo");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://html.duckduckgo.com/html/",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to Bing when DuckDuckGo scrape is bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      engine: "Bing",
      snippet:
        "GitHub is the leading platform for software collaboration and version control.",
      title: "GitHub",
      url: "https://github.com/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses Google scrape only when explicitly enabled", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toHaveLength(2);
    expect(results[0]?.engine).toBe("Google");
    expect(results[0]?.title).toBe("GitHub · Build and ship software");
    expect(results[0]?.url).toBe("https://github.com/");
    expect(results[0]?.snippet).toContain("100 million developers");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("uses heuristic extraction when Bing selectors miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-heuristic.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("beta");

    expect(results).toEqual([
      {
        engine: "Bing",
        snippet:
          "includes enough nearby body text to become a cleaned snippet even when standard selectors are absent.",
        title: "Example Beta",
        url: "https://example.org/beta",
      },
    ]);
  });

  it("normalizes Bing wrapper URLs to final targets", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-wrapper.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("wrapped-result");

    expect(results).toEqual([
      {
        engine: "Bing",
        snippet: "Bing wrapper URLs should decode to final usable targets.",
        title: "Example Wrapped Result",
        url: "https://example.net/path?x=1",
      },
    ]);
  });

  it("uses heuristic extraction when Google selectors miss", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-heuristic.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("alpha");

    expect(results).toEqual([
      {
        engine: "Google",
        snippet:
          "is a detailed external result with useful descriptive text for testing heuristic extraction.",
        title: "Example Alpha",
        url: "https://example.com/alpha",
      },
    ]);
  });

  it("normalizes Google redirect URLs in heuristic extraction", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-heuristic.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("alpha-normalized");

    expect(results[0]?.engine).toBe("Google");
    expect(results[0]?.url).toBe("https://example.com/alpha");
    expect(results).toHaveLength(1);
  });

  it("does not return Google support/help/feedback links from heuristic extraction", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-support-only.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("blocked-ish-query")).rejects.toThrow(
      "All search engines failed: DuckDuckGo, Bing, Google [DuckDuckGo:blocked; Bing:blocked; Google:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws a meaningful error when all enabled engines fail or are bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: DuckDuckGo, Bing [DuckDuckGo:blocked; Bing:blocked]"
    );
  });

  it("does not retry when mixed failures produce the terminal aggregated error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockRejectedValueOnce(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("mixed-failure", 5)).rejects.toThrow(
      "Search failed across all engines: DuckDuckGo, Bing [DuckDuckGo:blocked; Bing:transient]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry when Exa rejects the request with payment/auth failure", async () => {
    process.env.EXA_API_KEY = "exa-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 402 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      searchWithRetryAndCache("exa-auth-failure", 5)
    ).rejects.toThrow(
      "Search failed across all engines: Exa, DuckDuckGo, Bing [Exa:misconfigured; DuckDuckGo:blocked; Bing:blocked]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws No Results when all enabled engines explicitly return no-results", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("noresultsquery")).rejects.toThrow("No Results");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("searchWithRetryAndCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetSearchEnv();
  });

  it("retries on transient errors", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const resultPromise = searchWithRetryAndCache("github-retry", 5);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  }, 30_000);

  it("does NOT retry on No Results after the full fallback chain", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("nothing", 5)).rejects.toThrow(
      "No Results"
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses the fallback chain and caches the final successful result", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const firstResults = await searchWithRetryAndCache(
      "github-cached-fallback",
      10
    );
    const secondResults = await searchWithRetryAndCache(
      "github-cached-fallback",
      10
    );

    expect(firstResults).toEqual(secondResults);
    expect(firstResults[0]?.engine).toBe("Bing");
    expect(firstResults[0]?.title).toBe("GitHub");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses Google only after Bing fails when opt-in is enabled", async () => {
    process.env.OPENSEARCH_ENABLE_GOOGLE_SCRAPE = "true";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await searchWithRetryAndCache("google-last", 5);

    expect(results[0]?.engine).toBe("Google");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("re-fetches after TTL expiry", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          createMockResponse(readFixture("duckduckgo-github.html"))
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    await searchWithRetryAndCache("github-ttl", 10);
    vi.advanceTimersByTime(4 * 60 * 1000);
    await searchWithRetryAndCache("github-ttl", 10);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("slices results to max_results", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          createMockResponse(readFixture("duckduckgo-github.html"))
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await searchWithRetryAndCache("github-slice", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
