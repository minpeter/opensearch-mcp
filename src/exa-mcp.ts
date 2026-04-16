import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  createExaMcpServerUrl,
  DEFAULT_EXA_MCP_SEARCH_TOOL,
  type ExaMcpContentItem,
  parseExaMcpContentItems,
} from "./exa-mcp-provider.ts";

const EXA_MCP_TIMEOUT_MS = 8000;

export interface ExaMcpSearchResult {
  snippet: string;
  title: string;
  url: string;
}

export async function searchExaMcp(
  query: string,
  numResults: number
): Promise<ExaMcpSearchResult[]> {
  const client = new Client({
    name: "opensearch-exa-mcp-client",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(createExaMcpServerUrl(undefined, [DEFAULT_EXA_MCP_SEARCH_TOOL])),
    {
      requestInit: {
        signal: AbortSignal.timeout(EXA_MCP_TIMEOUT_MS),
      },
    }
  );

  try {
    await client.connect(transport);
    const response = await client.callTool({
      arguments: {
        numResults,
        query,
      },
      name: DEFAULT_EXA_MCP_SEARCH_TOOL,
    });

    if (response.isError) {
      throw new Error(getExaMcpErrorText(response.content));
    }

    return parseExaMcpContentItems(response.content as ExaMcpContentItem[]).map(
      ({ engine: _engine, ...result }) => result
    );
  } finally {
    await transport.close().catch(() => {
      // Ignore close errors; the search result/error is more important.
    });
  }
}

function getExaMcpErrorText(content: unknown): string {
  const text = Array.isArray(content)
    ? content
        .filter(
          (item): item is { text?: string; type?: string } =>
            typeof item === "object" && item !== null
        )
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n")
        .trim()
    : "";

  return text || "Exa MCP search failed";
}
