import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H1_TAG_REGEX = /<h1>/;
const P_TAG_REGEX = /<p>/;
const DIV_TAG_REGEX = /<div>/;
const MD_IMAGE_REGEX = /!\[.*?\]\(.*?\)/;
const IMG_TAG_REGEX = /<img/;
const JINA_URL_REGEX = /r\.jina\.ai/;

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

const { fetchExaMcp, fetchExaMcpBatch } = vi.hoisted(() => ({
  fetchExaMcp: vi.fn(),
  fetchExaMcpBatch: vi.fn(),
}));

vi.mock("../exa-mcp.ts", () => ({
  fetchExaMcp,
  fetchExaMcpBatch,
}));

import { extractText, getDocumentProxy } from "unpdf";

import {
  fetchUrl,
  fetchUrls,
  fetchUrlsWithCache,
  fetchUrlWithCache,
} from "../fetch.ts";

type MockPdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

function createMockPdfDocument(): MockPdfDocument {
  return Object.create(null) as MockPdfDocument;
}

const ARTICLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Heading</h1>
    <p>This is a test paragraph with some <strong>bold text</strong> and a <a href="https://example.com">link</a>.</p>
    <p>Second paragraph with more content to ensure Readability extracts it.</p>
    <img src="test.jpg" alt="test image">
    <p>Third paragraph. This is enough content for Readability to parse.</p>
  </article>
</body>
</html>`;

function createMockResponse(body: string, contentType = "text/html"): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

function stubHtmlFetch(html = ARTICLE_HTML) {
  const mockFetch = vi.fn().mockResolvedValue(createMockResponse(html));
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  process.env.OPENSEARCH_ENABLE_EXA_MCP = "true";
  delete process.env.EXA_API_KEY;
  fetchExaMcp.mockReset();
  fetchExaMcp.mockRejectedValue(new Error("Exa MCP unavailable"));
  fetchExaMcpBatch.mockReset();
  fetchExaMcpBatch.mockRejectedValue(new Error("Exa MCP unavailable"));
});

describe("fetchUrl", () => {
  it("returns Exa MCP content first when available and preserves the requested URL", async () => {
    fetchExaMcp.mockResolvedValueOnce({
      content: "# Exa markdown body",
      title: "Exa title",
      url: "https://exa.ai/article",
    });
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(result).toEqual({
      content: "# Exa markdown body",
      title: "Exa title",
      url: "https://example.com/article",
      length: "# Exa markdown body".length,
    });
    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to the local fetch pipeline when Exa MCP fails", async () => {
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
  });

  it("falls back to the official Exa contents API when Exa MCP fails and EXA_API_KEY is set", async () => {
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcp.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# Exa API body",
              title: "Exa API title",
              url: "https://example.com/article",
            },
          ],
          statuses: [
            {
              id: "https://example.com/article",
              status: "success",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).toHaveBeenCalledWith("https://example.com/article");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.exa.ai/contents",
      expect.objectContaining({
        body: JSON.stringify({
          text: {
            maxCharacters: 12_000,
          },
          urls: ["https://example.com/article"],
        }),
        headers: expect.objectContaining({ "x-api-key": "exa-key" }),
        method: "POST",
      })
    );
    expect(result).toEqual({
      content: "# Exa API body",
      title: "Exa API title",
      url: "https://example.com/article",
      length: "# Exa API body".length,
    });
  });

  it("passes batched urls through hosted Exa MCP before per-url fallbacks", async () => {
    fetchExaMcpBatch.mockResolvedValueOnce([
      {
        content: "# First body",
        title: "First title",
        url: "https://example.com/one",
      },
      {
        content: "# Second body",
        title: "Second title",
        url: "https://example.com/two",
      },
    ]);
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls([
      "https://example.com/one",
      "https://example.com/two",
    ]);

    expect(fetchExaMcpBatch).toHaveBeenCalledWith(
      ["https://example.com/one", "https://example.com/two"],
      12_000
    );
    expect(results).toEqual([
      {
        content: "# First body",
        title: "First title",
        url: "https://example.com/one",
        length: "# First body".length,
      },
      {
        content: "# Second body",
        title: "Second title",
        url: "https://example.com/two",
        length: "# Second body".length,
      },
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("passes maxCharacters through to the official Exa contents API for batched fetches", async () => {
    process.env.EXA_API_KEY = "exa-key";
    fetchExaMcpBatch.mockRejectedValueOnce(new Error("Exa timeout"));
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# First Exa API body",
              title: "First Exa API title",
              url: "https://example.com/one",
            },
            {
              text: "# Second Exa API body",
              title: "Second Exa API title",
              url: "https://example.com/two",
            },
          ],
          statuses: [
            {
              id: "https://example.com/one",
              status: "success",
            },
            {
              id: "https://example.com/two",
              status: "success",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchUrls(
      ["https://example.com/one", "https://example.com/two"],
      4000
    );

    expect(fetchExaMcpBatch).toHaveBeenCalledWith(
      ["https://example.com/one", "https://example.com/two"],
      4000
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.exa.ai/contents",
      expect.objectContaining({
        body: JSON.stringify({
          text: {
            maxCharacters: 4000,
          },
          urls: ["https://example.com/one", "https://example.com/two"],
        }),
        headers: expect.objectContaining({ "x-api-key": "exa-key" }),
        method: "POST",
      })
    );
    expect(results).toEqual([
      {
        content: "# First Exa API body",
        title: "First Exa API title",
        url: "https://example.com/one",
        length: "# First Exa API body".length,
      },
      {
        content: "# Second Exa API body",
        title: "Second Exa API title",
        url: "https://example.com/two",
        length: "# Second Exa API body".length,
      },
    ]);
  });

  it("uses the official Exa contents API when hosted Exa MCP is disabled but EXA_API_KEY is set", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    process.env.EXA_API_KEY = "exa-key";
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              text: "# Exa API only body",
              title: "Exa API only title",
              url: "https://example.com/article",
            },
          ],
          statuses: [
            {
              id: "https://example.com/article",
              status: "success",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.title).toBe("Exa API only title");
    expect(result.content).toBe("# Exa API only body");
  });

  it("skips Exa MCP entirely when OPENSEARCH_ENABLE_EXA_MCP is false", async () => {
    process.env.OPENSEARCH_ENABLE_EXA_MCP = "false";
    const mockFetch = stubHtmlFetch();

    await fetchUrl("https://example.com/article");

    expect(fetchExaMcp).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns title and markdown content from HTML page", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.url).toBe("https://example.com/article");
    expect(typeof result.length).toBe("number");
    expect(result.length).toBeGreaterThan(0);
  });

  it("content is markdown (no raw HTML tags)", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).not.toMatch(H1_TAG_REGEX);
    expect(result.content).not.toMatch(P_TAG_REGEX);
    expect(result.content).not.toMatch(DIV_TAG_REGEX);
  });

  it("strips img tags from output", async () => {
    stubHtmlFetch();

    const result = await fetchUrl("https://example.com/article");

    expect(result.content).not.toMatch(MD_IMAGE_REGEX);
    expect(result.content).not.toMatch(IMG_TAG_REGEX);
  });

  it("returns short content for minimal HTML when Jina also fails", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse(minimalHtml))
      .mockRejectedValueOnce(new Error("Jina unavailable"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/minimal");

    expect(result.url).toBe("https://example.com/minimal");
    expect(typeof result.content).toBe("string");
  });
});

describe("fetchUrl - PDF", () => {
  it("detects PDF by URL extension and returns text content", async () => {
    const fakeText = "This is extracted PDF text content for testing purposes.";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ArrayBuffer(100), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      )
    );

    vi.mocked(getDocumentProxy).mockResolvedValue(createMockPdfDocument());
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl("https://example.com/document.pdf");

    expect(result.content).toBe(fakeText);
    expect(result.url).toBe("https://example.com/document.pdf");
  });

  it("detects PDF by Content-Type for non-.pdf URL", async () => {
    const fakeText = "PDF content detected by content-type header.";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ArrayBuffer(100), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
      )
    );

    vi.mocked(getDocumentProxy).mockResolvedValue(createMockPdfDocument());
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl("https://example.com/download/file");

    expect(result.content).toBe(fakeText);
  });
});

describe("fetchUrl - Jina fallback", () => {
  it("uses Jina fallback when content is less than 50 chars", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";
    const jinaContent =
      "This is the Jina AI extracted content that is much longer and more useful than the original short content.";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
      .mockResolvedValueOnce(new Response(jinaContent, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toBe(jinaContent);
    expect(result.length).toBe(jinaContent.length);
  });

  it("gracefully handles Jina fallback failure", async () => {
    const minimalHtml = "<html><body><p>Hi</p></body></html>";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
      .mockRejectedValueOnce(new Error("Jina timeout"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse-fail");

    expect(result.url).toBe("https://example.com/sparse-fail");
    expect(typeof result.content).toBe("string");
  });

  it("keeps extracted content when Jina returns a non-ok response", async () => {
    const minimalHtml =
      "<html><body><article><p>Hi</p></article></body></html>";

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
      .mockResolvedValueOnce(new Response("fallback error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchUrl("https://example.com/sparse-non-ok");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1]?.[0])).toMatch(JINA_URL_REGEX);
    expect(result.content).toContain("Hi");
    expect(result.content).not.toContain("fallback error");
  });
});

describe("fetchUrlWithCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("caches result and returns it on second call", async () => {
    const html = `<!DOCTYPE html><html><head><title>Cache Test</title></head>
    <body><article><h1>Cache Test</h1>
    <p>Testing that the cache works properly with multiple calls.</p>
    <p>This is more content to make Readability happy and extract the article.</p>
    <p>Yet another paragraph for good measure.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlWithCache("https://example.com/cached");
    await fetchUrlWithCache("https://example.com/cached");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after TTL expiry", async () => {
    const html = `<!DOCTYPE html><html><head><title>TTL Test</title></head>
    <body><article><h1>TTL Test</h1>
    <p>Testing that the TTL cache expires properly.</p>
    <p>More content to ensure Readability works correctly here.</p>
    <p>Final paragraph for the article body.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlWithCache("https://example.com/ttl-test");
    vi.advanceTimersByTime(4 * 60 * 1000);
    await fetchUrlWithCache("https://example.com/ttl-test");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("reuses cached results after batched fetch warmup when maxCharacters is omitted", async () => {
    fetchExaMcpBatch.mockRejectedValueOnce(new Error("Exa timeout"));
    const html = `<!DOCTYPE html><html><head><title>Batch Cache Test</title></head>
    <body><article><h1>Batch Cache Test</h1>
    <p>Testing that batched fetches populate per-url cache entries.</p>
    <p>More content to ensure Readability extracts the article body.</p>
    <p>Final paragraph for good measure.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchUrlsWithCache(["https://example.com/cached-batch"]);
    await fetchUrlWithCache("https://example.com/cached-batch");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
