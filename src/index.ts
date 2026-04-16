import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import pkg from "../package.json" with { type: "json" };
import { fetchUrlWithCache } from "./fetch.ts";
import { searchResultsSchema, searchWithRetryAndCache } from "./search.ts";
import {
  createFetchToolResult,
  createSearchToolResult,
  getFetchUrls,
  webFetchInputSchema,
  webFetchOutputSchema,
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
      "Search the web and return title, URL, snippet, and originating search engine for each result. `content` contains a compact text rendering of the returned results, and `structuredContent.results` contains the same result set in machine-readable form. Falls back through Brave → Exa API → Exa MCP hosted search → DuckDuckGo → Bing when configured, with Google scraping available as an opt-in last resort.",
    inputSchema: z.object({
      query: z.string().describe("Search query string."),
      max_results: z
        .int()
        .positive()
        .max(15)
        .default(5)
        .describe("Maximum number of results to return. (1-15)"),
    }),
    outputSchema: z.object({
      results: searchResultsSchema,
    }),
  },
  async ({ query, max_results }) => {
    try {
      return createSearchToolResult(
        query,
        await searchWithRetryAndCache(query, max_results)
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
      "Fetch one or more URLs and return extracted markdown. Supports legacy `url` plus batch `urls`. Single fetches keep the raw body in `content`, while batch fetches return multiple text blocks with per-URL metadata plus extracted content. `structuredContent.results` always contains the machine-readable fetch results, with top-level title/url/length preserved for single-fetch compatibility. Uses Exa's hosted MCP fetch path first when enabled, then falls back to local HTML/PDF extraction and finally Jina AI for sparse pages.",
    inputSchema: webFetchInputSchema,
    outputSchema: webFetchOutputSchema,
  },
  async (input) => {
    try {
      const results = await Promise.all(
        getFetchUrls(input).map((url) => fetchUrlWithCache(url))
      );
      return createFetchToolResult(results);
    } catch (error) {
      return createToolErrorResponse("web_fetch", "Fetch", error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
