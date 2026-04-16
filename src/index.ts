import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import pkg from "../package.json" with { type: "json" };
import { fetchResultSchema, fetchUrlWithCache } from "./fetch.ts";
import { searchResultsSchema, searchWithRetryAndCache } from "./search.ts";

const version: string = pkg.version;

const server = new McpServer({
  name: "opensearch",
  version,
});

function createTextContent(text: string) {
  return { type: "text" as const, text };
}

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
    content: [createTextContent(`${action} failed: ${errorMessage}`)],
    isError: true,
  };
}

server.registerTool(
  "web_search",
  {
    description:
      "Search the web and return title, URL, snippet, and originating search engine for each result. Falls back through DuckDuckGo → Google → Bing. Use when higher-quality websearch tools are unavailable.",
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
      const results = await searchWithRetryAndCache(query, max_results);

      return {
        content: [createTextContent(JSON.stringify(results))],
        structuredContent: { results },
      };
    } catch (error) {
      return createToolErrorResponse("web_search", "Search", error);
    }
  }
);

server.registerTool(
  "web_fetch",
  {
    description:
      "Fetch a URL and return its content as markdown. Supports HTML pages and PDF documents. Falls back to Jina AI for sparse pages.",
    inputSchema: z.object({
      url: z.url().describe("URL to fetch and extract content from."),
    }),
    outputSchema: fetchResultSchema,
  },
  async ({ url }) => {
    try {
      const result = await fetchUrlWithCache(url);

      const structured = {
        title: result.title,
        content: result.content,
        url: result.url,
        length: result.length,
      };
      return {
        content: [createTextContent(result.content)],
        structuredContent: structured,
      };
    } catch (error) {
      return createToolErrorResponse("web_fetch", "Fetch", error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
