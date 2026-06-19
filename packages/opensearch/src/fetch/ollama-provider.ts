import {
  type EnvironmentReader,
  processEnvironmentReader,
} from "../environment.ts";
import {
  isOllamaEnabled,
  isOllamaHttpError,
  isOllamaLocalEnabled,
  ollamaCloudFetch,
  ollamaLocalFetch,
  readOllamaApiKey,
} from "../providers/ollama/client.ts";
import { DEFAULT_MAX_CHARACTERS } from "./config.ts";
import { createFetchResult, type FetchResult } from "./result.ts";

const SHARED_AUTH_FAILURE_STATUSES = new Set([401, 402]);

/**
 * Best-effort page fetch via Ollama's web_fetch (local daemon first, then cloud
 * API key). Mirrors the search provider's shared-quota semantics: a local quota
 * (429) or backend (non-auth) HTTP failure is not retried against the cloud,
 * since both paths hit the same account backend.
 *
 * Returns null whenever Ollama cannot serve the URL so the fetch chain can move
 * on to the next provider.
 */
export async function tryFetchUrlViaOllama(
  url: string,
  maxCharacters: number = DEFAULT_MAX_CHARACTERS,
  env: EnvironmentReader = processEnvironmentReader
): Promise<FetchResult | null> {
  if (!isOllamaEnabled(env)) {
    return null;
  }

  if (isOllamaLocalEnabled(env)) {
    try {
      const result = await ollamaLocalFetch(url, env);
      if (result.content.trim().length > 0) {
        return createFetchResult(
          url,
          result.content.slice(0, maxCharacters),
          result.title
        );
      }
      // Empty content: fall through to the cloud path if configured.
    } catch (error) {
      if (!shouldFallThroughToCloud(error)) {
        return null;
      }
    }
  }

  const apiKey = readOllamaApiKey(env);
  if (!apiKey) {
    return null;
  }

  try {
    const result = await ollamaCloudFetch(url, apiKey);
    return createFetchResult(
      url,
      result.content.slice(0, maxCharacters),
      result.title
    );
  } catch {
    return null;
  }
}

/**
 * Batch wrapper: returns null when Ollama is disabled so the caller keeps its
 * existing batch pipeline; otherwise fetches each URL via Ollama, delegating
 * per-URL failures to `fallback`. The fallback must skip Ollama (see
 * fetchUrlViaProvidersInternal) to avoid retrying the same failing probe.
 */
export async function tryFetchUrlsViaOllama(
  urls: string[],
  maxCharacters: number,
  env: EnvironmentReader,
  fallback: (url: string) => Promise<FetchResult>
): Promise<FetchResult[] | null> {
  if (!isOllamaEnabled(env)) {
    return null;
  }

  return await Promise.all(
    urls.map(async (url) => {
      const result = await tryFetchUrlViaOllama(url, maxCharacters, env);
      return result ?? (await fallback(url));
    })
  );
}

/**
 * Decide whether a local-daemon fetch failure should fall through to the cloud
 * path. Only connection failures (daemon absent) and auth failures (account not
 * signed in) qualify — a quota exhaustion or other backend error reflects the
 * shared backend and must not be retried against the cloud.
 */
function shouldFallThroughToCloud(error: unknown): boolean {
  if (isOllamaHttpError(error)) {
    return SHARED_AUTH_FAILURE_STATUSES.has(error.status);
  }

  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return true;
    }
    const message = error.message.toLowerCase();
    return (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("fetch failed") ||
      message.includes("connect econn")
    );
  }

  return false;
}
