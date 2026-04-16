import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import pkg from "../package.json" with { type: "json" };
import { fetchUrlWithCache } from "./fetch.ts";
import { searchResultsSchema, searchWithRetryAndCache } from "./search.ts";

const server = new McpServer({
  name: "opensearch",
  version: pkg.version,
});

const textContentType = "text" as const;
interface SearchToolResultItem {
  engine: string;
  snippet: string;
  title: string;
  url: string;
}
type FetchToolResultPayload = Awaited<ReturnType<typeof fetchUrlWithCache>>;

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

export function createSearchContent(
  query: string,
  results: SearchToolResultItem[]
): string {
  const lines = results.map(
    (result, index) =>
      `${index + 1}. [${result.engine}] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
  );

  return `Returned ${results.length} search results for "${query}".\n\n${lines.join("\n\n")}`;
}

export function createSearchToolResult(
  query: string,
  results: SearchToolResultItem[]
) {
  return {
    content: [
      { type: textContentType, text: createSearchContent(query, results) },
    ],
    structuredContent: { results },
  };
}

export function createFetchToolResult(result: FetchToolResultPayload) {
  return {
    content: [{ type: textContentType, text: result.content }],
    structuredContent: {
      title: result.title,
      url: result.url,
      length: result.length,
    },
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
      "Fetch a URL and return its content as markdown. `content` contains the complete extracted body, and `structuredContent` contains extraction metadata. Supports HTML pages and PDF documents. Falls back to Jina AI for sparse pages.",
    inputSchema: z.object({
      url: z.url().describe("URL to fetch and extract content from."),
    }),
    outputSchema: z.object({
      title: z.string(),
      url: z.string(),
      length: z.number(),
    }),
  },
  async ({ url }) => {
    try {
      return createFetchToolResult(await fetchUrlWithCache(url));
    } catch (error) {
      return createToolErrorResponse("web_fetch", "Fetch", error);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
