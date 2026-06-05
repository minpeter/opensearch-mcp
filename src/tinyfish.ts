import { z } from "zod";

const TINYFISH_API_KEY_ENV = "TINYFISH_API_KEY";
const TINYFISH_FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";
const TINYFISH_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
const TINYFISH_TIMEOUT_MS = 30_000;

const tinyFishSearchResponseSchema = z.object({
  page: z.number(),
  query: z.string(),
  results: z.array(
    z.object({
      position: z.number(),
      site_name: z.string(),
      snippet: z.string(),
      title: z.string(),
      url: z.string(),
    })
  ),
  total_results: z.number(),
});

const tinyFishFetchResponseSchema = z.object({
  errors: z.array(
    z.object({
      error: z.string(),
      status: z.number().optional(),
      url: z.string(),
    })
  ),
  results: z.array(
    z.object({
      final_url: z.string(),
      format: z.string(),
      text: z.string(),
      title: z.string().optional(),
      url: z.string(),
    })
  ),
});

export interface TinyFishSearchResult {
  readonly snippet: string;
  readonly title: string;
  readonly url: string;
}

export interface TinyFishFetchResult {
  readonly content: string;
  readonly title: string;
}

let tinyFishApiKeyPoolSource: string | undefined;
let tinyFishApiKeyPool: readonly string[] | undefined;
let tinyFishApiKeyIndex = 0;

export function hasTinyFishApiKeys(): boolean {
  return getTinyFishApiKeyPool().length > 0;
}

export async function searchTinyFish(
  query: string
): Promise<TinyFishSearchResult[]> {
  const url = new URL(TINYFISH_SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("location", "US");
  url.searchParams.set("language", "en");
  url.searchParams.set("page", "0");

  const response = await requestTinyFishJson("search", (apiKey) =>
    fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      method: "GET",
      signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
    })
  );
  const parsed = tinyFishSearchResponseSchema.parse(response);

  return parsed.results.map((result) => ({
    snippet: result.snippet,
    title: result.title,
    url: result.url,
  }));
}

export async function fetchTinyFishUrls(
  urls: readonly string[]
): Promise<TinyFishFetchResult[]> {
  const response = await requestTinyFishJson("fetch", (apiKey) =>
    fetch(TINYFISH_FETCH_ENDPOINT, {
      body: JSON.stringify({
        format: "markdown",
        image_links: false,
        links: false,
        urls,
      }),
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      method: "POST",
      signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
    })
  );
  const parsed = tinyFishFetchResponseSchema.parse(response);

  return urls.map((url, index) => {
    const result =
      parsed.results.find(
        (candidate) => candidate.url === url || candidate.final_url === url
      ) ?? parsed.results[index];

    if (!result) {
      const error = parsed.errors.find((candidate) => candidate.url === url);
      throw new Error(
        error
          ? `TinyFish fetch failed for ${url}: ${error.error}`
          : "TinyFish fetch returned an unexpected response shape"
      );
    }

    return {
      content: result.text,
      title: result.title ?? "",
    };
  });
}

async function requestTinyFishJson(
  serviceName: "fetch" | "search",
  requestWithApiKey: (apiKey: string) => Promise<Response>
): Promise<unknown> {
  const [firstApiKey, ...remainingApiKeys] = getTinyFishApiKeyAttemptOrder();
  if (!firstApiKey) {
    throw new Error("TINYFISH_API_KEY is not configured");
  }

  const firstResponse = await requestWithApiKey(firstApiKey);
  if (firstResponse.status !== 429) {
    return parseTinyFishJsonResponse(firstResponse, serviceName);
  }

  let lastRateLimitError = await readTinyFishHttpError(
    firstResponse,
    serviceName
  );

  for (const apiKey of remainingApiKeys) {
    const response = await requestWithApiKey(apiKey);
    if (response.status !== 429) {
      return parseTinyFishJsonResponse(response, serviceName);
    }

    lastRateLimitError = await readTinyFishHttpError(response, serviceName);
  }

  if (remainingApiKeys.length === 0) {
    throw lastRateLimitError;
  }

  throw new Error(
    `${lastRateLimitError.message} (all ${
      remainingApiKeys.length + 1
    } configured TinyFish API keys returned HTTP 429)`
  );
}

function getTinyFishApiKeyAttemptOrder(): readonly string[] {
  const apiKeys = getTinyFishApiKeyPool();
  if (apiKeys.length === 0) {
    return [];
  }

  const startIndex = tinyFishApiKeyIndex % apiKeys.length;
  tinyFishApiKeyIndex = (startIndex + 1) % apiKeys.length;

  return [...apiKeys.slice(startIndex), ...apiKeys.slice(0, startIndex)];
}

function getTinyFishApiKeyPool(): readonly string[] {
  const apiKeyPoolSource = process.env[TINYFISH_API_KEY_ENV];

  if (
    apiKeyPoolSource !== tinyFishApiKeyPoolSource ||
    tinyFishApiKeyPool === undefined
  ) {
    tinyFishApiKeyPool = (apiKeyPoolSource ?? "")
      .split(";")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    tinyFishApiKeyPoolSource = apiKeyPoolSource;
    tinyFishApiKeyIndex = 0;
  }

  return tinyFishApiKeyPool;
}

async function parseTinyFishJsonResponse(
  response: Response,
  serviceName: "fetch" | "search"
): Promise<unknown> {
  const bodyText = await response.text();
  const { parseError, value } = parseJsonBody(bodyText);

  if (!response.ok) {
    throw createTinyFishHttpError(response, serviceName, value, parseError);
  }

  if (parseError) {
    throw new Error(`TinyFish returned invalid JSON: ${parseError}`);
  }

  return value;
}

async function readTinyFishHttpError(
  response: Response,
  serviceName: "fetch" | "search"
): Promise<Error> {
  const bodyText = await response.text();
  const { parseError, value } = parseJsonBody(bodyText);

  return createTinyFishHttpError(response, serviceName, value, parseError);
}

function createTinyFishHttpError(
  response: Response,
  serviceName: "fetch" | "search",
  body: unknown,
  parseError?: string
): Error {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMessage = retryAfter ? ` Retry-After: ${retryAfter}.` : "";

  return new Error(
    `TinyFish ${serviceName} request failed with HTTP ${
      response.status
    }: ${readErrorMessage(body, parseError)}.${retryAfterMessage}`
  );
}

function parseJsonBody(bodyText: string): {
  readonly parseError?: string;
  readonly value: unknown;
} {
  if (!bodyText.trim()) {
    return { value: {} };
  }

  try {
    return { value: JSON.parse(bodyText) as unknown };
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
      value: bodyText,
    };
  }
}

function readErrorMessage(body: unknown, parseError?: string): string {
  if (parseError) {
    return `invalid JSON response body: ${parseError}`;
  }

  if (typeof body === "object" && body !== null && "error" in body) {
    const error = body.error;
    if (typeof error === "string") {
      return error;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = error.message;
      if (typeof message === "string") {
        return message;
      }
    }
  }

  return "unknown error";
}
