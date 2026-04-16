import { z } from "zod";

import { type FetchResult } from "./fetch.ts";

const textContentType = "text" as const;
const MAX_FETCH_URLS = 10;
const DEFAULT_SEARCH_RESULT_COUNT = 5;
const MAX_SEARCH_RESULTS = 15;

const searchResultCountSchema = z
  .int()
  .positive()
  .max(MAX_SEARCH_RESULTS);

export interface SearchToolResultItem {
  engine: string;
  snippet: string;
  title: string;
  url: string;
}

export const webSearchInputSchema = z.object({
  query: z.string().describe("Search query string."),
  numResults: searchResultCountSchema.optional().describe(
    "Preferred result count to return. Mirrors Exa's numResults field. Defaults to 5. (1-15)"
  ),
  max_results: searchResultCountSchema.optional().describe(
    "Legacy alias for numResults. Defaults to 5. (1-15)"
  ),
});

export const webFetchInputSchema = z
  .object({
    urls: z
      .array(z.url())
      .min(1)
      .max(MAX_FETCH_URLS)
      .optional()
      .describe("Preferred batch of URLs to fetch and extract in one call."),
    url: z
      .url()
      .optional()
      .describe("Legacy single URL alias for urls."),
  })
  .refine(({ url, urls }) => Boolean(url || urls?.length), {
    message: "Provide urls or url.",
    path: ["urls"],
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
  };
}

export function getSearchResultCount(
  input: z.infer<typeof webSearchInputSchema>
): number {
  return input.numResults ?? input.max_results ?? DEFAULT_SEARCH_RESULT_COUNT;
}

export function getFetchUrls(
  input: z.infer<typeof webFetchInputSchema>
): string[] {
  const merged = [...(input.urls ?? []), input.url].filter(
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

  if (normalizedResults.length === 1) {
    return {
      content: [
        {
          type: textContentType,
          text: createFetchContentBlock(firstResult, 0, normalizedResults.length),
        },
      ],
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
  };
}
