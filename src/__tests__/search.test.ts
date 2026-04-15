import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { search, searchWithRetryAndCache } from '../search.ts';

function createMockResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('search', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results from real DuckDuckGo HTML fixture', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-github.html'), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(html)));

    const results = await search('github');

    expect(results.length).toBeGreaterThan(5);
    expect(results.every((r) => r.title && r.url && r.snippet)).toBe(true);
    expect(results[0]!.title).toBeTruthy();
    expect(results[0]!.url).toBeTruthy();
    expect(results[0]!.snippet).toBeTruthy();
  });

  it('throws "No Results" error for no-results fixture', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-no-results.html'), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(html)));

    await expect(search('noresultsquery')).rejects.toThrow('No Results');
  });

  it('throws bot detection error for challenge-form fixture', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-challenge.html'), 'utf-8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse(html)));

    await expect(search('test')).rejects.toThrow(/Too many requests|Bot detected/);
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));

    await expect(search('test')).rejects.toThrow(/429/);
  });
});

describe('searchWithRetryAndCache', () => {
  const fixturesDir = join(import.meta.dirname, 'fixtures');

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries on transient errors', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-github.html'), 'utf-8');
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(
        new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = searchWithRetryAndCache('github-retry', 5);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 30_000);

  it('does NOT retry on "No Results" error', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-no-results.html'), 'utf-8');
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', mockFetch);

    await expect(searchWithRetryAndCache('nothing', 5)).rejects.toThrow('No Results');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns cached result on second call', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-github.html'), 'utf-8');
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', mockFetch);

    await searchWithRetryAndCache('github-cached', 10);
    await searchWithRetryAndCache('github-cached', 10);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after TTL expiry', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-github.html'), 'utf-8');
    const mockFetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })),
      );
    vi.stubGlobal('fetch', mockFetch);

    await searchWithRetryAndCache('github-ttl', 10);
    vi.advanceTimersByTime(4 * 60 * 1000);
    await searchWithRetryAndCache('github-ttl', 10);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('slices results to max_results', async () => {
    const html = readFileSync(join(fixturesDir, 'duckduckgo-github.html'), 'utf-8');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const results = await searchWithRetryAndCache('github-slice', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
