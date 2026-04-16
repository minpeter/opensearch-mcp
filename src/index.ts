import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import pkg from "../package.json" with { type: "json" };
import { fetchUrlsWithCache } from "./fetch.ts";
import { searchWithRetryAndCache } from "./search.ts";
import {
  createFetchToolResult,
  createSearchToolResult,
  getFetchMaxCharacters,
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
    description: `Search the web for any topic and get clean, ready-to-use content.

Best for: Finding current information, news, facts, people, companies, or answering questions about any topic.
Returns: Clean text content from top search results.

Query tips:
describe the ideal page, not keywords. "blog post comparing React and Vue performance" not "React vs Vue".
If highlights are insufficient, follow up with web_fetch on the best URLs.`,
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
    description: `Read a webpage's full content as clean markdown. Use after web_search when highlights are insufficient or to read any URL.

Best for: Extracting full content from known URLs. Batch multiple URLs in one call.
Returns: Clean text content and metadata from the page(s).`,
    inputSchema: webFetchInputSchema,
  },
  async (input) => {
    try {
      const results = await fetchUrlsWithCache(
        input.urls,
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
