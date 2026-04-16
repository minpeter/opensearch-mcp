export const DEFAULT_EXA_MCP_SERVER_URL = "https://mcp.exa.ai/mcp";
export const DEFAULT_EXA_MCP_SEARCH_TOOL = "web_search_exa";
const SEARCH_RESULT_SEPARATOR = /\n\s*---\s*\n/gu;
const MAX_SNIPPET_LENGTH = 280;

export interface ExaMcpSearchResult {
  engine: "Exa";
  snippet: string;
  title: string;
  url: string;
}

export interface ExaMcpContentItem {
  text?: string;
  type?: string;
}

export function createExaMcpServerUrl(
  baseUrl = DEFAULT_EXA_MCP_SERVER_URL,
  enabledTools: string[] = [DEFAULT_EXA_MCP_SEARCH_TOOL]
): string {
  const url = new URL(baseUrl);
  const normalizedTools = [
    ...new Set(enabledTools.map((tool) => tool.trim()).filter(Boolean)),
  ];

  if (normalizedTools.length === 0) {
    url.searchParams.delete("tools");
    return url.toString();
  }

  url.searchParams.set("tools", normalizedTools.join(","));
  return url.toString();
}

export function parseExaMcpContentItems(
  content: ExaMcpContentItem[] | undefined
): ExaMcpSearchResult[] {
  if (!content) {
    return [];
  }

  const results = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .flatMap((item) => parseExaMcpSearchToolText(item.text ?? ""));

  return dedupeByUrl(results);
}

export function parseExaMcpSearchToolText(text: string): ExaMcpSearchResult[] {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return [];
  }

  const blocks = trimmedText.includes("\n---\n")
    ? trimmedText.split(SEARCH_RESULT_SEPARATOR)
    : [trimmedText];

  const results = blocks
    .map((block) => parseExaMcpResultBlock(block))
    .filter((result): result is ExaMcpSearchResult => result !== null);

  return dedupeByUrl(results);
}

function parseExaMcpResultBlock(block: string): ExaMcpSearchResult | null {
  const lines = block
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  let title = "";
  let url = "";
  let snippet = "";
  let activeMultilineField: "highlights" | null = null;
  const highlightLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("Title:")) {
      title = trimmedLine.slice("Title:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (trimmedLine.startsWith("URL:")) {
      url = trimmedLine.slice("URL:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (trimmedLine.startsWith("Highlights:")) {
      activeMultilineField = "highlights";
      const inlineHighlights = trimmedLine.slice("Highlights:".length).trim();
      if (inlineHighlights) {
        highlightLines.push(inlineHighlights);
      }
      continue;
    }

    if (trimmedLine.startsWith("Text:")) {
      snippet = trimmedLine.slice("Text:".length).trim();
      activeMultilineField = null;
      continue;
    }

    if (
      trimmedLine.startsWith("Published:") ||
      trimmedLine.startsWith("Author:")
    ) {
      activeMultilineField = null;
      continue;
    }

    if (activeMultilineField === "highlights") {
      highlightLines.push(trimmedLine);
    }
  }

  const normalizedSnippet = truncateText(
    cleanText(highlightLines[0] ?? snippet),
    MAX_SNIPPET_LENGTH
  );

  if (!(title && url && normalizedSnippet)) {
    return null;
  }

  return {
    engine: "Exa",
    snippet: normalizedSnippet,
    title,
    url,
  };
}

function dedupeByUrl(results: ExaMcpSearchResult[]): ExaMcpSearchResult[] {
  const seenUrls = new Set<string>();

  return results.filter((result) => {
    if (seenUrls.has(result.url)) {
      return false;
    }

    seenUrls.add(result.url);
    return true;
  });
}

function cleanText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncatedText = text.slice(0, maxLength).trimEnd();
  const lastSpaceIndex = truncatedText.lastIndexOf(" ");

  if (lastSpaceIndex <= maxLength / 2) {
    return `${truncatedText}…`;
  }

  return `${truncatedText.slice(0, lastSpaceIndex)}…`;
}
