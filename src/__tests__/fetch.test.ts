import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('unpdf', () => ({
  getDocumentProxy: vi.fn(),
  extractText: vi.fn(),
}));

import { extractText, getDocumentProxy } from 'unpdf';

import { fetchUrl, fetchUrlWithCache } from '../fetch.ts';

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

function createMockResponse(body: string, contentType = 'text/html'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

describe('fetchUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns title and markdown content from HTML page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(ARTICLE_HTML)));

    const result = await fetchUrl('https://example.com/article');

    expect(result.title).toBeTruthy();
    expect(result.content).toBeTruthy();
    expect(result.url).toBe('https://example.com/article');
    expect(typeof result.length).toBe('number');
    expect(result.length).toBeGreaterThan(0);
  });

  it('content is markdown (no raw HTML tags)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(ARTICLE_HTML)));

    const result = await fetchUrl('https://example.com/article');

    expect(result.content).not.toMatch(/<h1>/);
    expect(result.content).not.toMatch(/<p>/);
    expect(result.content).not.toMatch(/<div>/);
  });

  it('strips img tags from output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(ARTICLE_HTML)));

    const result = await fetchUrl('https://example.com/article');

    expect(result.content).not.toMatch(/!\[.*?\]\(.*?\)/);
    expect(result.content).not.toMatch(/<img/);
  });

  it('returns short content for minimal HTML when Jina also fails', async () => {
    const minimalHtml = '<html><body><p>Hi</p></body></html>';
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(createMockResponse(minimalHtml))
      .mockRejectedValueOnce(new Error('Jina unavailable'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchUrl('https://example.com/minimal');

    expect(result.url).toBe('https://example.com/minimal');
    expect(typeof result.content).toBe('string');
  });
});

describe('fetchUrl - PDF', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects PDF by URL extension and returns text content', async () => {
    const fakeText = 'This is extracted PDF text content for testing purposes.';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(100), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    ));

    vi.mocked(getDocumentProxy).mockResolvedValue({} as never);
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl('https://example.com/document.pdf');

    expect(result.content).toBe(fakeText);
    expect(result.url).toBe('https://example.com/document.pdf');
  });

  it('detects PDF by Content-Type for non-.pdf URL', async () => {
    const fakeText = 'PDF content detected by content-type header.';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(new ArrayBuffer(100), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    ));

    vi.mocked(getDocumentProxy).mockResolvedValue({} as never);
    vi.mocked(extractText).mockResolvedValue({ text: fakeText, totalPages: 1 });

    const result = await fetchUrl('https://example.com/download/file');

    expect(result.content).toBe(fakeText);
  });
});

describe('fetchUrl - Jina fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Jina fallback when content is less than 50 chars', async () => {
    const minimalHtml = '<html><body><p>Hi</p></body></html>';
    const jinaContent = 'This is the Jina AI extracted content that is much longer and more useful than the original short content.';

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, { status: 200, headers: { 'Content-Type': 'text/html' } })
      )
      .mockResolvedValueOnce(
        new Response(jinaContent, { status: 200 })
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchUrl('https://example.com/sparse');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![0]).toContain('r.jina.ai');
    expect(result.content).toBe(jinaContent);
  });

  it('gracefully handles Jina fallback failure', async () => {
    const minimalHtml = '<html><body><p>Hi</p></body></html>';

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(minimalHtml, { status: 200, headers: { 'Content-Type': 'text/html' } })
      )
      .mockRejectedValueOnce(new Error('Jina timeout'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await fetchUrl('https://example.com/sparse-fail');

    expect(result.url).toBe('https://example.com/sparse-fail');
    expect(typeof result.content).toBe('string');
  });
});

describe('fetchUrlWithCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('caches result and returns it on second call', async () => {
    const html = `<!DOCTYPE html><html><head><title>Cache Test</title></head>
    <body><article><h1>Cache Test</h1>
    <p>Testing that the cache works properly with multiple calls.</p>
    <p>This is more content to make Readability happy and extract the article.</p>
    <p>Yet another paragraph for good measure.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    );
    vi.stubGlobal('fetch', mockFetch);

    await fetchUrlWithCache('https://example.com/cached');
    await fetchUrlWithCache('https://example.com/cached');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expiry', async () => {
    const html = `<!DOCTYPE html><html><head><title>TTL Test</title></head>
    <body><article><h1>TTL Test</h1>
    <p>Testing that the TTL cache expires properly.</p>
    <p>More content to ensure Readability works correctly here.</p>
    <p>Final paragraph for the article body.</p></article></body></html>`;

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    );
    vi.stubGlobal('fetch', mockFetch);

    await fetchUrlWithCache('https://example.com/ttl-test');
    vi.advanceTimersByTime(4 * 60 * 1000);
    await fetchUrlWithCache('https://example.com/ttl-test');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
