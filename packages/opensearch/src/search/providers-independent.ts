import {
  createJsonSearchProvider,
  getBaseUrl,
  getEnvPool,
  parseArrayFromAnyPath,
  parseCommonResultArray,
  requireTrustedProviderBaseUrl,
} from "./api-provider-utils.ts";
import { createSearchUrl } from "./http.ts";
import type { SearchProvider } from "./types.ts";

export function createIndependentProviders(): SearchProvider[] {
  return [
    ...getEnvPool("KAGI_API_KEY").map(createKagiProvider),
    ...getEnvPool("KAGI_API_TOKEN").map(createKagiProvider),
    ...getEnvPool("MOJEEK_API_KEY").map(createMojeekProvider),
    ...getEnvPool("OPENSEARCH_SEARXNG_URLS").map(createSearxngProvider),
  ];
}

function createKagiProvider(apiKey: string): SearchProvider {
  return createJsonSearchProvider({
    name: "Kagi",
    buildRequest: (query, numResults) => ({
      headers: { Authorization: `Bot ${apiKey}` },
      method: "GET",
      url: createSearchUrl(
        getBaseUrl("OPENSEARCH_KAGI_URL", "https://kagi.com/api/v1/search"),
        {
          limit: String(numResults),
          q: query,
        }
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["data"]),
  });
}

function createMojeekProvider(apiKey: string): SearchProvider {
  return createJsonSearchProvider({
    name: "Mojeek",
    buildRequest: (query, numResults) => ({
      method: "GET",
      url: createSearchUrl(
        getBaseUrl("OPENSEARCH_MOJEEK_URL", "https://www.mojeek.com/search"),
        {
          api_key: apiKey,
          fmt: "json",
          q: query,
          s: String(numResults),
        }
      ),
    }),
    parse: (payload) =>
      parseArrayFromAnyPath(payload, [["response", "results"], ["results"]]),
  });
}

function createSearxngProvider(baseUrl: string): SearchProvider {
  return createJsonSearchProvider({
    name: "SearxNG",
    buildRequest: (query) => ({
      method: "GET",
      url: createSearchUrl(
        new URL(
          "/search",
          requireTrustedProviderBaseUrl("OPENSEARCH_SEARXNG_URLS", baseUrl)
        ).toString(),
        {
          format: "json",
          language: "en-US",
          q: query,
          safesearch: "1",
        }
      ),
    }),
    parse: (payload) => parseCommonResultArray(payload, ["results"]),
  });
}
