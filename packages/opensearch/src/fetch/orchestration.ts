import { fetchExaMcp, fetchExaMcpBatch } from "../exa-mcp.ts";
import { hasTinyFishApiKeys } from "../tinyfish/api-key-pool.ts";
import { fetchTinyFishUrls } from "../tinyfish/fetch.ts";
import {
  DEFAULT_MAX_CHARACTERS,
  EXA_API_KEY_ENV,
  OPENSEARCH_ENABLE_EXA_MCP_ENV,
} from "./config.ts";
import { fetchExaApi, fetchExaApiBatch } from "./exa-api.ts";
import { fetchLocalUrl } from "./local.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

export function fetchUrl(url: string): Promise<FetchResult> {
  return fetchUrlDirect(url);
}

async function fetchUrlDirect(url: string): Promise<FetchResult> {
  if (isExaMcpEnabled()) {
    try {
      const exaResult = await fetchExaMcp(url);
      return createFetchResult(url, exaResult.content, exaResult.title);
    } catch {
      // Fall through to the official Exa API or local fetch pipeline.
    }
  }

  if (hasTinyFishApiKeys()) {
    try {
      const [tinyFishResult] = await fetchTinyFishUrls([url]);
      if (!tinyFishResult) {
        throw new Error("TinyFish fetch returned an unexpected response shape");
      }
      return createFetchResult(
        url,
        tinyFishResult.content,
        tinyFishResult.title
      );
    } catch {
      return fetchUrlWithoutTinyFish(url);
    }
  }

  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApi(url);
    } catch {
      // Fall through to the local fetch pipeline.
    }
  }

  return fetchLocalUrl(url);
}

async function fetchUrlWithoutTinyFish(url: string): Promise<FetchResult> {
  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApi(url);
    } catch {
      return fetchLocalUrl(url);
    }
  }

  return fetchLocalUrl(url);
}

export async function fetchUrls(
  urls: string[],
  maxCharacters = DEFAULT_MAX_CHARACTERS
): Promise<FetchResult[]> {
  if (urls.length === 0) {
    return [];
  }

  if (isExaMcpEnabled()) {
    try {
      const exaResults = await fetchExaMcpBatch(urls, maxCharacters);
      return urls.map((url, index) => {
        const exaResult =
          exaResults.find((result) => result.url === url) ?? exaResults[index];

        if (!exaResult) {
          throw new Error(
            "Exa MCP fetch returned an unexpected response shape"
          );
        }

        return createFetchResult(url, exaResult.content, exaResult.title);
      });
    } catch {
      // Fall through to the official Exa API or local fetch pipeline.
    }
  }

  if (hasTinyFishApiKeys()) {
    try {
      const tinyFishResults = await fetchTinyFishUrls(urls);
      return urls.map((url, index) => {
        const result = tinyFishResults[index];
        if (!result) {
          throw new Error(
            "TinyFish fetch returned an unexpected response shape"
          );
        }
        return createFetchResult(url, result.content, result.title);
      });
    } catch {
      return fetchUrlsWithoutTinyFish(urls, maxCharacters);
    }
  }

  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApiBatch(urls, maxCharacters);
    } catch {
      // Fall through to the local fetch pipeline.
    }
  }

  return Promise.all(urls.map((url) => fetchUrlDirect(url)));
}

async function fetchUrlsWithoutTinyFish(
  urls: string[],
  maxCharacters: number
): Promise<FetchResult[]> {
  if (process.env[EXA_API_KEY_ENV]?.trim()) {
    try {
      return await fetchExaApiBatch(urls, maxCharacters);
    } catch {
      return Promise.all(urls.map((url) => fetchLocalUrl(url)));
    }
  }

  return Promise.all(urls.map((url) => fetchLocalUrl(url)));
}

function isExaMcpEnabled(): boolean {
  return process.env[OPENSEARCH_ENABLE_EXA_MCP_ENV] !== "false";
}
