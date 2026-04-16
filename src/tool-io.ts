import { z } from "zod";

import { type FetchResult, fetchResultSchema } from "./fetch.ts";

const textContentType = "text" as const;
const MAX_FETCH_URLS = 10;

export interface SearchToolResultItem {
  engine: string;
  snippet: string;
  title: string;
  url: string;
}

export const webFetchInputSchema = z
  .object({
    url: z.url().optional().describe("URL to fetch and extract content from."),
    urls: z
      .array(z.url())
      .min(1)
      .max(MAX_FETCH_URLS)
      .optional()
      .describe(
        "Optional batch of URLs to fetch and extract. Use when you want one call to fetch multiple pages."
      ),
  })
  .refine(({ url, urls }) => Boolean(url || urls?.length), {
    message: "Provide url or urls.",
    path: ["url"],
  });

export const webFetchOutputSchema = z.object({
  count: z.number(),
  results: z.array(fetchResultSchema),
  title: z.string().optional(),
  url: z.string().optional(),
  length: z.number().optional(),
});

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

export function getFetchUrls(
  input: z.infer<typeof webFetchInputSchema>
): string[] {
  const merged = [input.url, ...(input.urls ?? [])].filter(
    (value): value is string => Boolean(value)
  );

  return [...new Set(merged)];
}

function createFetchContentBlock(
  result: FetchResult,
  index: number,
  total: number
): string {
  const heading = result.title || result.url;
  const prefix = total > 1 ? `# ${index + 1}. ${heading}` : `# ${heading}`;

  return `${prefix}\nURL: ${result.url}\nLength: ${result.length}\n\n${result.content}`;
}

export function createFetchToolResult(results: FetchResult | FetchResult[]) {
  const normalizedResults = Array.isArray(results) ? results : [results];
  const [firstResult] = normalizedResults;

  if (!firstResult) {
    throw new Error("Fetch returned no results");
  }

  const structuredContent = {
    count: normalizedResults.length,
    results: normalizedResults,
    ...(normalizedResults.length === 1
      ? {
          title: firstResult.title,
          url: firstResult.url,
          length: firstResult.length,
        }
      : {}),
  };

  if (normalizedResults.length === 1) {
    return {
      content: [{ type: textContentType, text: firstResult.content }],
      structuredContent,
    };
  }

  return {
    content: [
      {
        type: textContentType,
        text: `Fetched ${normalizedResults.length} URLs. Each block below contains extracted markdown plus source metadata.`,
      },
      ...normalizedResults.map((result, index) => ({
        type: textContentType,
        text: createFetchContentBlock(result, index, normalizedResults.length),
      })),
    ],
    structuredContent,
  };
}
