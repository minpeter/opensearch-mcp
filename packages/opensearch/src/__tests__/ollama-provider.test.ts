import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEnvironmentReader } from "../environment.ts";
import { tryFetchUrlViaOllama } from "../fetch/ollama-provider.ts";
import { resolveLocalBaseUrl } from "../providers/ollama/client.ts";
import { createOllamaSearchProvider } from "../search/providers/ollama.ts";
import { search } from "../search.ts";
import {
  createMockJsonResponse,
  resetSearchEnv,
} from "./search-test-helpers.ts";

function ollamaSearchBody(
  results: Array<{
    title?: string;
    url?: string;
    content?: string;
  }> = []
) {
  return { results };
}

function connectionRefusedError(): TypeError {
  return new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
}

function requestOf(
  mockFetch: ReturnType<typeof vi.fn>,
  index = 0
): { url: string; init: RequestInit; body: unknown } {
  const [url, init] = mockFetch.mock.calls[index] ?? [];
  const body = init?.body;
  return {
    body: typeof body === "string" ? JSON.parse(body) : undefined,
    init: init ?? {},
    url: String(url),
  };
}

function enableOllamaEnv(overrides: Record<string, string> = {}) {
  return createEnvironmentReader({
    OPENSEARCH_ENABLE_OLLAMA: "true",
    ...overrides,
  });
}

function getOllamaSearchProvider(
  env: ReturnType<typeof createEnvironmentReader>
) {
  const provider = createOllamaSearchProvider(env);
  if (!provider) {
    throw new Error("Ollama search provider was not enabled for this test");
  }
  return provider;
}

describe("Ollama client", () => {
  it("resolves OLLAMA_HOST without a scheme to an http origin", () => {
    const env = createEnvironmentReader({ OLLAMA_HOST: "127.0.0.1:11434" });
    expect(resolveLocalBaseUrl(env)).toBe("http://127.0.0.1:11434");
  });

  it("preserves an explicit https OLLAMA_HOST and strips the path", () => {
    const env = createEnvironmentReader({
      OLLAMA_HOST: "https://ollama.example.internal:8443/foo",
    });
    expect(resolveLocalBaseUrl(env)).toBe(
      "https://ollama.example.internal:8443"
    );
  });

  it("falls back to the default local URL for malformed hosts", () => {
    const env = createEnvironmentReader({ OLLAMA_HOST: "::::" });
    expect(resolveLocalBaseUrl(env)).toBe("http://localhost:11434");
  });
});

describe("Ollama search provider", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("is not registered when not opted in", () => {
    const env = createEnvironmentReader({});
    expect(createOllamaSearchProvider(env)).toBeNull();
  });

  it("searches via the local daemon without an API key", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse(
        ollamaSearchBody([
          {
            content: "Ollama content snippet",
            title: "Ollama Docs",
            url: "https://docs.ollama.com/",
          },
        ])
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("ollama docs", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, body, init } = requestOf(mockFetch);
    expect(url).toBe("http://localhost:11434/api/experimental/web_search");
    expect(body).toEqual({ query: "ollama docs", max_results: 5 });
    expect(
      (init.headers as Record<string, string>).Authorization
    ).toBeUndefined();
    expect(results).toEqual([
      {
        engine: "Ollama",
        snippet: "Ollama content snippet",
        title: "Ollama Docs",
        url: "https://docs.ollama.com/",
      },
    ]);
  });

  it("caps max_results at the cloud API limit of 10", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ title: "t", url: "https://x/", content: "c" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await provider.search("q", 20);

    expect(requestOf(mockFetch).body).toEqual({ query: "q", max_results: 10 });
  });

  it("falls back to the cloud API when the local daemon is unreachable", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(connectionRefusedError())
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([
            { title: "Cloud", url: "https://c/", content: "snippet" },
          ])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("cloud query", 4);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    const cloud = requestOf(mockFetch, 1);
    expect(cloud.url).toBe("https://ollama.com/api/web_search");
    expect(cloud.body).toEqual({ query: "cloud query", max_results: 4 });
    expect((cloud.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer ollama-key"
    );
    expect(results[0]).toMatchObject({ engine: "Ollama", url: "https://c/" });
  });

  it("does not retry the cloud path on a local 429 (shared quota)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          { error: "you have reached your web search hourly request limit" },
          429
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "blocked",
      status: 429,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to the cloud path when the local daemon is unsigned (401)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "Unauthorized" }, 401)
      )
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ title: "C", url: "https://c/", content: "s" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    const results = await provider.search("q", 3);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 1).url).toBe(
      "https://ollama.com/api/web_search"
    );
    expect(results[0]).toMatchObject({ engine: "Ollama" });
  });

  it("reports misconfigured when the daemon is unreachable and no key is set", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockRejectedValueOnce(connectionRefusedError());
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "misconfigured",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("classifies a cloud 429 as blocked", async () => {
    const env = enableOllamaEnv({
      OLLAMA_API_KEY: "ollama-key",
      OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "blocked",
      status: 429,
    });
  });

  it("classifies a cloud 401 as misconfigured", async () => {
    const env = enableOllamaEnv({
      OLLAMA_API_KEY: "ollama-key",
      OPENSEARCH_DISABLE_OLLAMA_LOCAL: "true",
    });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "Unauthorized" }, 401)
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "misconfigured",
      status: 401,
    });
  });

  it("treats an empty result set as no-results without hitting the cloud", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockJsonResponse(ollamaSearchBody([])));
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await expect(provider.search("q", 5)).rejects.toMatchObject({
      engine: "Ollama",
      kind: "no-results",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("respects OLLAMA_HOST when calling the local daemon", async () => {
    const env = enableOllamaEnv({ OLLAMA_HOST: "127.0.0.1:11434" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([{ title: "t", url: "https://x/", content: "c" }])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const provider = getOllamaSearchProvider(env);
    await provider.search("q", 5);

    expect(requestOf(mockFetch).url).toBe(
      "http://127.0.0.1:11434/api/experimental/web_search"
    );
  });
});

describe("Ollama search chain integration", () => {
  beforeEach(() => {
    resetSearchEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetSearchEnv();
  });

  it("tries Ollama before a configured keyed provider", async () => {
    process.env.OPENSEARCH_ENABLE_OLLAMA = "true";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse(
          ollamaSearchBody([
            { title: "Local", url: "https://local/", content: "snippet" },
          ])
        )
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("query", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    expect(results[0]).toMatchObject({
      engine: "Ollama",
      url: "https://local/",
    });
  });

  it("moves on to the next provider when Ollama hits the shared quota", async () => {
    process.env.OPENSEARCH_ENABLE_OLLAMA = "true";
    process.env.OLLAMA_API_KEY = "ollama-key";
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi
      .fn()
      // Ollama local: 429 (shared quota).
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      )
      // Brave: succeeds.
      .mockResolvedValueOnce(
        createMockJsonResponse({
          web: {
            results: [
              {
                description: "brave snippet",
                title: "Brave",
                url: "https://brave/",
              },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("query", 5);

    expect(requestOf(mockFetch, 0).url).toBe(
      "http://localhost:11434/api/experimental/web_search"
    );
    expect(requestOf(mockFetch, 1).url).toContain("api.search.brave.com");
    expect(results[0]).toMatchObject({
      engine: "Brave",
      url: "https://brave/",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("is absent from the chain when not opted in", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key";

    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        web: {
          results: [
            { description: "s", title: "Brave", url: "https://brave/" },
          ],
        },
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await search("query", 5);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestOf(mockFetch, 0).url).toContain("api.search.brave.com");
    expect(results.every((r) => r.engine !== "Ollama")).toBe(true);
  });
});

describe("Ollama fetch provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when not opted in", async () => {
    const env = createEnvironmentReader({});
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches via the local daemon and truncates to maxCharacters", async () => {
    const env = enableOllamaEnv();
    const longContent = "A".repeat(50);
    const mockFetch = vi.fn().mockResolvedValueOnce(
      createMockJsonResponse({
        content: longContent,
        links: ["https://iana.org/domains/example"],
        title: "Example Domain",
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama("https://example.com/", 10, env);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const { url, body } = requestOf(mockFetch);
    expect(url).toBe("http://localhost:11434/api/experimental/web_fetch");
    expect(body).toEqual({ url: "https://example.com/" });
    expect(result).toMatchObject({
      title: "Example Domain",
      content: "AAAAAAAAAA",
      length: 10,
      url: "https://example.com/",
    });
  });

  it("falls back to the cloud path on a local connection failure", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(connectionRefusedError())
      .mockResolvedValueOnce(
        createMockJsonResponse({
          content: "cloud content",
          title: "Cloud",
          links: [],
        })
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestOf(mockFetch, 1).url).toBe(
      "https://ollama.com/api/web_fetch"
    );
    expect(result).toMatchObject({ title: "Cloud", content: "cloud content" });
  });

  it("does not retry the cloud path after a local 429 (shared quota)", async () => {
    const env = enableOllamaEnv({ OLLAMA_API_KEY: "ollama-key" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        createMockJsonResponse({ error: "hourly limit" }, 429)
      );
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when the daemon is unreachable and no key is set", async () => {
    const env = enableOllamaEnv();
    const mockFetch = vi.fn().mockRejectedValueOnce(connectionRefusedError());
    vi.stubGlobal("fetch", mockFetch);

    const result = await tryFetchUrlViaOllama(
      "https://example.com/",
      1000,
      env
    );

    expect(result).toBeNull();
  });
});
