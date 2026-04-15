import pkg from '../package.json' with { type: 'json' };

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { fetchUrlWithCache } from './fetch.ts';
import { searchWithRetryAndCache } from './search.ts';

const version: string = pkg.version;

const server = new McpServer({
  name: 'opensearch',
  version,
});

server.registerTool(
  'web_search',
  {
    description:
      'Search DuckDuckGo and return title, URL, and snippet for each result. Use when higher-quality websearch tools are unavailable.',
    inputSchema: z.object({
      query: z.string().describe('Search query string.'),
      max_results: z.number().int().positive().max(15).default(5).describe('Maximum number of results to return. (1-15)'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        }),
      ),
    }),
  },
  async ({ query, max_results }) => {
    try {
      const results = await searchWithRetryAndCache(query, max_results);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results) }],
        structuredContent: { results },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[opensearch] web_search failed: ${errorMessage}`);
      return {
        content: [{ type: 'text' as const, text: `Search failed: ${errorMessage}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  'web_fetch',
  {
    description:
      'Fetch a URL and return its content as markdown. Supports HTML pages and PDF documents. Falls back to Jina AI for sparse pages.',
    inputSchema: z.object({
      url: z.string().url().describe('URL to fetch and extract content from.'),
    }),
    outputSchema: z.object({
      title: z.string(),
      content: z.string(),
      url: z.string(),
      length: z.number(),
    }),
  },
  async ({ url }) => {
    try {
      const result = await fetchUrlWithCache(url);

      const structured = { title: result.title, content: result.content, url: result.url, length: result.length };
      return {
        content: [{ type: 'text' as const, text: result.content }],
        structuredContent: structured,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[opensearch] web_fetch failed: ${errorMessage}`);
      return {
        content: [{ type: 'text' as const, text: `Fetch failed: ${errorMessage}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
