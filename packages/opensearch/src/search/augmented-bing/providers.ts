import { getBaseUrl } from "../api-provider-utils.ts";
import { getErrorMessage, SearchEngineError } from "../errors.ts";
import {
  createSearchRequestInit,
  createSearchUrl,
  fetchSearchText,
  parseJsonResponse,
} from "../http.ts";
import { attachEngine } from "../text.ts";
import type {
  ParsedResult,
  SearchEngineName,
  SearchProvider,
} from "../types.ts";
import {
  parseInternetArchiveResults,
  parseWibyResults,
  parseWikipediaResults,
} from "../zero-key-parsers.ts";

type HtmlParser = (html: string) => ParsedResult[];
type JsonParser = (payload: unknown) => ParsedResult[];

const INTERNET_ARCHIVE_FIELDS = ["identifier", "title", "description"] as const;

export function createAugmentedBingSupplementalProviders(): SearchProvider[] {
  return [
    createJsonProvider("Wikipedia", createWikipediaUrl, parseWikipediaResults),
    createHtmlProvider("Wiby", createWibyUrl, parseWibyResults),
    createJsonProvider(
      "InternetArchive",
      createInternetArchiveUrl,
      parseInternetArchiveResults
    ),
  ];
}

function createHtmlProvider(
  name: SearchEngineName,
  createUrl: (query: string) => string,
  parse: HtmlParser
): SearchProvider {
  return {
    name,
    async search(query: string, numResults: number) {
      try {
        const body = await fetchSearchText({
          engine: name,
          init: createSearchRequestInit("GET"),
          url: createUrl(query),
        });
        return attachEngine(name, parse(body).slice(0, numResults));
      } catch (error) {
        throw toProviderError(name, error);
      }
    },
  };
}

function createJsonProvider(
  name: SearchEngineName,
  createUrl: (query: string, numResults: number) => string,
  parse: JsonParser
): SearchProvider {
  return {
    name,
    async search(query: string, numResults: number) {
      try {
        const body = await fetchSearchText({
          engine: name,
          init: createSearchRequestInit("GET"),
          url: createUrl(query, numResults),
        });
        return attachEngine(
          name,
          parse(parseJsonResponse(body, name)).slice(0, numResults)
        );
      } catch (error) {
        throw toProviderError(name, error);
      }
    },
  };
}

function toProviderError(
  engine: SearchEngineName,
  error: unknown
): SearchEngineError {
  if (error instanceof SearchEngineError) {
    return error;
  }

  return new SearchEngineError(
    engine,
    "transient",
    `${engine} search failed: ${getErrorMessage(error)}`
  );
}

function createWibyUrl(query: string): string {
  return createSearchUrl(
    getBaseUrl("OPENSEARCH_WIBY_URL", "https://wiby.me/"),
    { q: query }
  );
}

function createWikipediaUrl(query: string, numResults: number): string {
  return createSearchUrl(
    getBaseUrl(
      "OPENSEARCH_WIKIPEDIA_URL",
      "https://en.wikipedia.org/w/api.php"
    ),
    {
      action: "query",
      format: "json",
      list: "search",
      origin: "*",
      srlimit: String(numResults),
      srsearch: query,
    }
  );
}

function createInternetArchiveUrl(query: string, numResults: number): string {
  const url = new URL(
    getBaseUrl(
      "OPENSEARCH_INTERNET_ARCHIVE_URL",
      "https://archive.org/advancedsearch.php"
    )
  );
  url.searchParams.set("q", query);
  url.searchParams.set("rows", String(numResults));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");

  for (const field of INTERNET_ARCHIVE_FIELDS) {
    url.searchParams.append("fl[]", field);
  }

  return url.toString();
}
