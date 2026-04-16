import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { search, searchWithRetryAndCache } from "../search.ts";

const fixturesDir = join(import.meta.dirname, "fixtures");
function createMockResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("search", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns DuckDuckGo results when primary succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results.length).toBeGreaterThan(5);
    expect(
      results.every(
        (result) =>
          result.title &&
          result.url &&
          result.snippet &&
          result.engine === "DuckDuckGo"
      )
    ).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://html.duckduckgo.com/html/",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to Google when DuckDuckGo is bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      engine: "Google",
      snippet:
        "GitHub is where over 100 million developers shape the future of software.",
      title: "GitHub · Build and ship software",
      url: "https://github.com/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("https://www.google.com/search?q=github&hl=en"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("falls back to Bing when DuckDuckGo is bot-detected and Google fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-github.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("github");

    expect(results).toHaveLength(2);
    expect(results[0]?.engine).toBe("Bing");
    expect(results[0]?.title).toBe("GitHub");
    expect(results[0]?.url).toBe("https://github.com/");
    expect(results[0]?.snippet).toContain("software collaboration");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining(
        "https://www.bing.com/search?q=github&setlang=en-US"
      ),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("uses heuristic extraction when Google selectors miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
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

  it("uses heuristic extraction when Bing selectors miss", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-challenge.html"))
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
        createMockResponse(readFixture("google-challenge.html"))
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

  it("normalizes Google redirect URLs in heuristic extraction", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
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
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-support-only.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("blocked-ish-query")).rejects.toThrow(
      "All search engines failed: DuckDuckGo, Google, Bing [DuckDuckGo:blocked; Google:no-results; Bing:no-results]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws a meaningful error when all engines fail or are bot-detected", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("github")).rejects.toThrow(
      "All search engines failed: DuckDuckGo, Google, Bing [DuckDuckGo:blocked; Google:blocked; Bing:blocked]"
    );
  });

  it("does not retry when mixed failures produce the terminal aggregated error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-challenge.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("mixed-failure", 5)).rejects.toThrow(
      "Search failed across all engines: DuckDuckGo, Google, Bing [DuckDuckGo:blocked; Google:transient; Bing:blocked]"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws No Results when all engines explicitly return no-results", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(search("noresultsquery")).rejects.toThrow("No Results");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe("searchWithRetryAndCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries on transient errors", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
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
    expect(mockFetch).toHaveBeenCalledTimes(7);
  }, 30_000);

  it("does NOT retry on No Results after the full fallback chain", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-no-results.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("bing-no-results.html"))
      );
    vi.stubGlobal("fetch", mockFetch);

    await expect(searchWithRetryAndCache("nothing", 5)).rejects.toThrow(
      "No Results"
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("uses the fallback chain and caches the final successful result", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockResponse(readFixture("duckduckgo-challenge.html"))
      )
      .mockResolvedValueOnce(
        createMockResponse(readFixture("google-challenge.html"))
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
