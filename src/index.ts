import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../package.json" with { type: "json" };
import { fetchUrlsWithCache } from "./fetch.ts";
import { searchWithRetryAndCache } from "./search.ts";
import {
  createFetchToolResult,
  createSearchToolResult,
  getFetchMaxCharacters,
  getFetchUrls,
  getSearchResultCount,
  webFetchInputSchema,
  webSearchInputSchema,
} from "./tool-io.ts";

const server = new McpServer({
  name: "opensearch",
  version: pkg.version,
});

const textContentType = "text" as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createToolErrorResponse(
  toolName: string,
  action: string,
  error: unknown
) {
  const errorMessage = getErrorMessage(error);
  console.error(`[opensearch] ${toolName} failed: ${errorMessage}`);

  return {
    content: [
      { type: textContentType, text: `${action} failed: ${errorMessage}` },
    ],
    isError: true,
  };
}

server.registerTool(
  "web_search",
  {
    description:
      "Search the web and return a text-first result list with title, URL, snippet, and originating search engine for each hit. Falls back through Brave → Exa MCP hosted search (free tier first) → Exa API when configured → DuckDuckGo → Bing, with Google scraping available as an opt-in last resort.",
    inputSchema: webSearchInputSchema,
  },
  async (input) => {
    try {
      return createSearchToolResult(
        input.query,
        await searchWithRetryAndCache(input.query, getSearchResultCount(input))
      );
    } catch (error) {
      return createToolErrorResponse("web_search", "Search", error);
    }
  }
);

server.registerTool(
  "web_fetch",
  {
    description:
      "Fetch one or more URLs and return text-first extracted markdown blocks. Supports legacy `url` plus batch `urls`. Each response block includes source metadata followed by extracted content. Uses Exa's hosted MCP fetch path first when enabled so the hosted free tier is attempted before `EXA_API_KEY` usage, then falls back to Exa's official contents API, local HTML/PDF extraction, and finally Jina AI for sparse pages.",
    inputSchema: webFetchInputSchema,
  },
  async (input) => {
    try {
      const results = await fetchUrlsWithCache(
        getFetchUrls(input),
        getFetchMaxCharacters(input)
      );
      return createFetchToolResult(results);
    } catch (error) {
      return createToolErrorResponse("web_fetch", "Fetch", error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
