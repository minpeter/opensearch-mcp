import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSearchText } from "../search/http.ts";
import { search } from "./full-runtime.ts";
import {
  createMockJsonResponse,
  createMockResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

describe("search provider security guardrails", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("does not send credential headers to non-HTTPS endpoint overrides", async () => {
    process.env.OPENSEARCH_SEARXNG_URLS = "https://searx.example";
    process.env.OPENSEARCH_TAVILY_URL = "http://evil.example/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Safe fallback result.",
            title: "SearxNG fallback",
            url: "https://example.com/safe",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("override guard", 1);

    expect(results[0]).toEqual({
      engine: "SearxNG",
      snippet: "Safe fallback result.",
      title: "SearxNG fallback",
      url: "https://example.com/safe",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("https://searx.example/search");
    expect(requestedUrls.join("\n")).not.toContain("evil.example");
  });

  it("does not fetch non-local HTTP SearxNG endpoint overrides", async () => {
    // Two SearxNG endpoints: a remote HTTP one (rejected by the trusted-base-url
    // guard before any fetch) and a localhost one (allowed for local gateways).
    process.env.OPENSEARCH_SEARXNG_URLS =
      "http://evil.example;http://localhost";

    const mockFetch = vi.fn().mockResolvedValue(
      createMockJsonResponse({
        results: [
          {
            content: "Trusted SearxNG result.",
            title: "Trusted SearxNG",
            url: "https://example.com/trusted",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("searxng override guard", 1);

    expect(results[0]).toEqual({
      engine: "SearxNG",
      snippet: "Trusted SearxNG result.",
      title: "Trusted SearxNG",
      url: "https://example.com/trusted",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("http://localhost/search");
    expect(requestedUrls.join("\n")).not.toContain("evil.example");
  });

  it("ignores removed Wikipedia overrides and keeps DuckDuckGo as the keyless fallback", async () => {
    process.env.OPENSEARCH_WIKIPEDIA_URL = "http://localhost/wikipedia";

    const mockFetch = vi.fn((url: string | URL) => {
      const requestUrl = String(url);
      if (requestUrl.includes("localhost/wikipedia")) {
        return Promise.resolve(
          createMockJsonResponse({
            query: {
              search: [
                {
                  pageid: 123,
                  snippet: "Removed Wikipedia override.",
                  title: "Removed override",
                },
              ],
            },
          })
        );
      }
      return Promise.resolve(
        createMockResponse(`
          <div id="links">
            <div class="result results_links">
              <h2 class="result__title">
                <a class="result__a" href="https://example.com/duckduckgo">DuckDuckGo</a>
              </h2>
              <a class="result__a" href="https://example.com/duckduckgo">DuckDuckGo</a>
              <div class="result__snippet">DuckDuckGo remains the keyless fallback.</div>
            </div>
          </div>
        `)
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("removed wikipedia override guard", 1);

    expect(results[0]).toEqual({
      engine: "DuckDuckGo",
      snippet: "DuckDuckGo remains the keyless fallback.",
      title: "DuckDuckGo",
      url: "https://example.com/duckduckgo",
    });
    const requestedUrls = mockFetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("https://html.duckduckgo.com/html/");
    expect(requestedUrls.join("\n")).not.toContain("localhost/wikipedia");
  });

  it("allows local HTTP endpoint overrides for tests and private gateways", async () => {
    process.env.OPENSEARCH_TAVILY_URL = "http://127.0.0.1:43111/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "Local override result.",
            title: "Local Tavily",
            url: "https://example.com/local",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("local override", 1);

    expect(results[0]?.engine).toBe("Tavily");
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "http://127.0.0.1:43111/search"
    );
  });

  it("allows IPv6 localhost HTTP endpoint overrides", async () => {
    process.env.OPENSEARCH_TAVILY_URL = "http://[::1]:43111/search";
    process.env.TAVILY_API_KEY = "tavily-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        results: [
          {
            content: "IPv6 local override result.",
            title: "IPv6 Tavily",
            url: "https://example.com/ipv6-local",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("ipv6 local override", 1);

    expect(results[0]?.engine).toBe("Tavily");
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain(
      "http://[::1]:43111/search"
    );
  });

  it("does not automatically follow provider redirects with auth headers", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchSearchText({
      engine: "Tavily",
      init: {
        headers: { "X-API-Key": "secret" },
        method: "GET",
      },
      url: "https://api.tavily.com/search",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ redirect: "manual" })
    );
  });
});
