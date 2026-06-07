import { TtlCache } from "./cache.ts";
import {
  fetchUrls as fetchUrlsWithoutCache,
  fetchUrl as fetchUrlWithoutCache,
} from "./fetch/orchestration.ts";
import {
  type FetchResult,
  fetchResultSchema as fetchResultSchemaValue,
} from "./fetch/result.ts";

export type { FetchResult } from "./fetch/result.ts";

export const fetchResultSchema = fetchResultSchemaValue;

const fetchCache = new TtlCache<string, FetchResult>(3 * 60 * 1000);

export interface FetchOptions {
  readonly maxCharacters?: number;
}

export function fetchUrl(url: string): Promise<FetchResult> {
  return fetchUrlWithoutCache(url);
}

export function fetchUrls(
  urls: string[],
  maxCharacters?: number
): Promise<FetchResult[]> {
  return fetchUrlsWithoutCache(urls, maxCharacters);
}

export function fetchUrlWithCache(url: string): Promise<FetchResult> {
  return fetchCache.getOrSet(url, () => fetchUrl(url));
}

export async function fetchUrlsWithCache(
  urls: string[],
  maxCharacters?: number
): Promise<FetchResult[]> {
  if (urls.length === 1 && maxCharacters === undefined) {
    const [url] = urls;
    return url ? [await fetchUrlWithCache(url)] : [];
  }

  if (maxCharacters !== undefined) {
    return fetchUrls(urls, maxCharacters);
  }

  const uncachedUrls = urls.filter((url) => !fetchCache.has(url));

  if (uncachedUrls.length > 0) {
    const fetchedResults = await fetchUrls(uncachedUrls);

    for (const result of fetchedResults) {
      fetchCache.set(result.url, result);
    }
  }

  return Promise.all(urls.map((url) => fetchUrlWithCache(url)));
}

export function fetch(
  url: string,
  options?: FetchOptions
): Promise<FetchResult>;
export function fetch(
  urls: readonly string[],
  options?: FetchOptions
): Promise<FetchResult[]>;
export async function fetch(
  input: string | readonly string[],
  options: FetchOptions = {}
): Promise<FetchResult | FetchResult[]> {
  const { maxCharacters } = options;

  if (typeof input === "string") {
    if (maxCharacters === undefined) {
      return fetchUrlWithCache(input);
    }

    const [result] = await fetchUrlsWithCache([input], maxCharacters);
    if (!result) {
      throw new Error("Fetch returned no result.");
    }
    return result;
  }

  return fetchUrlsWithCache([...input], maxCharacters);
}
