import { load } from "cheerio";
import pRetry from "p-retry";

import { TtlCache } from "./cache.ts";
import { getRandomUserAgent } from "./user-agents.ts";

export interface SearchResult {
  snippet: string;
  title: string;
  url: string;
}

export async function search(query: string): Promise<SearchResult[]> {
  const formData = new FormData();
  formData.append("q", query);

  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": getRandomUserAgent() },
    body: formData,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed with status ${res.status}`);
  }

  const html = await res.text();
  const $ = load(html);

  if ($(".no-results").length > 0) {
    throw new Error("No Results");
  }

  if ($(".challenge-form, #challenge-form").length > 0) {
    throw new Error("Too many requests (Bot detected)");
  }

  const results: SearchResult[] = [];

  $(
    ".zci, #links > .result, .result.results_links, .result.results_links_deep"
  ).each((_, el) => {
    const titleEl = $(el)
      .find(".zci__heading > a, .result__title .result__a, .result__a")
      .first();
    const snippetEl = $(el).find(".zci__result, .result__snippet").first();

    const title = titleEl.text().trim();
    const url = titleEl.attr("href")?.trim() ?? "";
    const snippet = snippetEl.text().trim();

    if (title && url && snippet) {
      results.push({ title, url, snippet });
    }
  });

  return results;
}

const searchCache = new TtlCache<string, SearchResult[]>(3 * 60 * 1000);

export async function searchWithRetryAndCache(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  if (searchCache.has(query)) {
    return (searchCache.get(query) ?? []).slice(0, maxResults);
  }

  const results = await pRetry(() => search(query), {
    retries: 2,
    minTimeout: 2000,
    factor: 2,
    shouldRetry: ({ error }) => {
      if (error.message.includes("No Results")) {
        return false;
      }
      return true;
    },
  });

  searchCache.set(query, results);
  return results.slice(0, maxResults);
}
