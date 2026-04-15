// Integration tests — require network access
import { describe, expect, it } from 'vitest';

import { fetchUrl } from '../fetch.ts';
import { search } from '../search.ts';

describe('integration: web_search (real network)', () => {
  it(
    'search("typescript programming language") returns results with all fields',
    { timeout: 15_000 },
    async () => {
      let results: Awaited<ReturnType<typeof search>>;
      try {
        results = await search('typescript programming language');
      } catch (err) {
        if (err instanceof Error && err.message.includes('Bot detected')) {
          console.warn('DuckDuckGo rate-limited — skipping assertion');
          return;
        }
        throw err;
      }

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.title && r.url && r.snippet)).toBe(true);
    },
  );
});

describe('integration: web_fetch (real network)', () => {
  it(
    'fetchUrl("https://example.com") returns markdown content',
    { timeout: 30_000 },
    async () => {
      const result = await fetchUrl('https://example.com');

      expect(result.title).toBeTruthy();
      expect(result.content).toBeTruthy();
      expect(result.url).toBe('https://example.com');
      expect(result.length).toBeGreaterThan(0);

      // Content should be markdown, not raw HTML
      expect(result.content).not.toMatch(/<html/i);
      expect(result.content).not.toMatch(/<body/i);
      expect(result.content).not.toMatch(/<div/i);
    },
  );
});
